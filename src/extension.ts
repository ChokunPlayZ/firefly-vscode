import * as vscode from "vscode";
import { SerialPort } from "serialport";
import * as fs from "fs/promises";
import * as path from "path";
import { prepareFileBlockFrame, prepareFileHeaderFrame } from "./lib/fireflyMeta";

let config: { device: { name: string | null; uploadPath: string | null } } = {
  device: { name: null, uploadPath: null },
};
let port: SerialPort | null = null;
let selectedPort: string | undefined;
let statusBar: vscode.StatusBarItem;
let uploadCancellationToken: vscode.CancellationTokenSource | null = null;
let isDisconnecting = false;

const FILE_BLOCK_SIZE = 240;

async function sendFile(
  port: SerialPort,
  inputFilePath: string,
  targetFilePath: string
): Promise<void> {
  uploadCancellationToken = new vscode.CancellationTokenSource();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Uploading to device",
      cancellable: true,
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        uploadCancellationToken?.cancel();
        vscode.window.showInformationMessage("Upload cancelled.");
      });

      statusBar.text = `$(build) uploading ${0}%`;
      progress.report({ increment: 0 });

      const inputFileData = await fs.readFile(inputFilePath);
      const inputFileLen = inputFileData.length;

      try {
        // Prepare and send the file header
        const headerFrame = await prepareFileHeaderFrame(
          inputFileLen,
          targetFilePath,
          inputFileData
        );
        await writeToPort(port, headerFrame);

        // Send file blocks
        let fileOffset = 0;
        let percent = 0;
        let lastPercent = 0;
        while (fileOffset < inputFileLen) {
          if (uploadCancellationToken && uploadCancellationToken.token.isCancellationRequested) {
            throw new Error("Upload cancelled");
          }

          const sendFileSize = Math.min(
            FILE_BLOCK_SIZE,
            inputFileLen - fileOffset
          );
          const blockFrame = await prepareFileBlockFrame(
            inputFileData,
            fileOffset,
            sendFileSize
          );
          await writeToPort(port, blockFrame);
          fileOffset += sendFileSize;
          percent = 100 * fileOffset / inputFileLen;
          if (percent - lastPercent > 1) {
            if (percent > 99.1) {
              percent = 100;
              statusBar.text = `$(cloud-upload) Upload Complete!`;
              setTimeout(() => {
                updateStatusBar();
              }, 5000);
            } else {
              progress.report({ increment: percent - lastPercent });
              statusBar.text = `$(cloud-upload) Uploading ${Math.round(percent)}%`;
            }
            lastPercent = percent;
          }
        }
      } catch (error) {
        if ((error as Error).message === "Upload cancelled") {
          vscode.window.showInformationMessage("Upload cancelled.");
        } else if ((error as Error).message === "Port is not open" && !isDisconnecting) {
          vscode.window.showErrorMessage("Device unexpectedly disconnected during upload.");
          await deviceDisconnect(true);
        } else {
          throw error;
        }
      } finally {
        uploadCancellationToken = null;
      }
    }
  );
}

async function writeToPort(port: SerialPort, data: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!port.isOpen) {
      reject(new Error("Port is not open"));
      return;
    }

    if (port.write(data)) {
      port.drain((error) => {
        if (error) reject(error);
        else resolve();
      });
    } else {
      port.once("drain", () => {
        port.drain((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }).then(() => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for device response"));
      }, 5000);

      const dataHandler = () => {
        clearTimeout(timeout);
        port.removeListener('close', closeHandler);
        port.removeListener('error', errorHandler);
        resolve();
      };

      const closeHandler = () => {
        clearTimeout(timeout);
        port.removeListener('data', dataHandler);
        port.removeListener('error', errorHandler);
        if (!isDisconnecting) {
          reject(new Error("Port is not open"));
        } else {
          resolve();
        }
      };

      const errorHandler = (error: unknown) => {
        clearTimeout(timeout);
        port.removeListener('data', dataHandler);
        port.removeListener('close', closeHandler);
        reject(error as Error);
      };

      port.once("data", dataHandler);
      port.once("close", closeHandler);
      port.once("error", errorHandler);
    });
  });
}

async function deviceDisconnect(isUnexpected: boolean = false): Promise<void> {
  if (port) {
    isDisconnecting = true;
    if (port.isOpen) {
      await new Promise<void>((resolve, reject) => {
        port!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    port = null;
    if (isUnexpected) {
      vscode.window.showErrorMessage("Device unexpectedly disconnected");
      if (uploadCancellationToken) {
        uploadCancellationToken.cancel();
        uploadCancellationToken = null;
      }
    } else {
      vscode.window.showInformationMessage("Disconnected from device");
    }
  } else {
    port = null;
    vscode.window.showInformationMessage("No device connected");
  }
  isDisconnecting = false;
  updateStatusBar();
}

async function deviceConnect(): Promise<void> {
  if (port) {
    vscode.window.showInformationMessage("Device already connected");
    return;
  }
  // connect to device
  selectedPort = await selectSerialPort();

  if (!selectedPort) {
    vscode.window.showErrorMessage("No serial port selected.");
    return;
  }

  try {
    port = new SerialPort({ path: selectedPort, baudRate: 115200 });
    await new Promise<void>((resolve, reject) => {
      port!.on("open", resolve);
      port!.on("error", reject);
      // check for port disconnection and act accordingly
      port!.on("close", () => {
        if (!isDisconnecting) {
          deviceDisconnect(true);
        }
      });
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Error opening serial port: ${error}`);
    return;
  } finally {
    vscode.window.showInformationMessage(`Connected to ${selectedPort}`);
    updateStatusBar();
  }
}

async function loadConfig(workspaceFolder: string | undefined): Promise<void> {
  if (!workspaceFolder) return;
  const configPath = path.join(workspaceFolder || "", "firefly.config.json");
  try {
    const configData = await fs.readFile(configPath, "utf8");
    config = JSON.parse(configData);
  } catch (error) { }
}

async function updateStatusBar(): Promise<void> {
  if (port) {
    statusBar.text = `$(pass) Connected to ${selectedPort}`;
    statusBar.command = "firefly.device.disconnect";
  } else {
    statusBar.text = `$(debug-disconnect) Disconnected`;
    statusBar.command = "firefly.device.connect";
  }
  statusBar.show();
}

async function selectSerialPort(): Promise<string | undefined> {
  const ports = await SerialPort.list();
  const validPorts = ports.filter((port) => port.vendorId);
  // 0x7523
  // 1a86

  const portItems = validPorts.map((port) => ({
    label: port.path,
    description: port.vendorId,
  }));

  const selectedPort = await vscode.window.showQuickPick(portItems, {
    placeHolder: "Select a serial port",
    canPickMany: false,
  });

  return selectedPort?.label;
}

async function fileUpload(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor found.");
    return;
  }

  const document = editor.document;
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("No workspace folder found.");
    return;
  }

  await loadConfig(workspaceFolder);

  if (!port || !port.isOpen) {
    await deviceConnect();
  }

  if (!port?.isOpen) {
    vscode.window.showErrorMessage("Device not connected, try reloading");
    return;
  }

  if (!config.device.uploadPath) {
    vscode.window.showErrorMessage("Config File is not Complete, please check");
    return;
  }

  const filePath = document.uri.fsPath;

  try {
    await sendFile(port!, filePath, config.device.uploadPath ? config.device.uploadPath : "");
    vscode.window.showInformationMessage(`Upload successful!`);
  } catch (error) {
    if ((error as Error).message === "Port is not open" && !isDisconnecting) {
      vscode.window.showErrorMessage("Device unexpectedly disconnected during upload.");
      await deviceDisconnect(true);
    } else {
      vscode.window.showErrorMessage(`Error during file upload: ${error}`);
    }
  } finally {
    updateStatusBar();
  }
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  // await loadConfig(vscode.workspace.workspaceFolders?.[0].uri.fsPath);

  // if (!config.device.name) {
  //   return;
  // }
  
  context.subscriptions.push(
    vscode.commands.registerCommand("firefly.uploadFile", fileUpload)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("firefly.device.connect", deviceConnect)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "firefly.device.disconnect",
      deviceDisconnect
    )
  );

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.hide();
  context.subscriptions.push(statusBar);
  updateStatusBar();
}

export async function deactivate(): Promise<void> {
  if (port) {
    await new Promise<void>((resolve, reject) => {
      port!.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    port = null;
  }
}
