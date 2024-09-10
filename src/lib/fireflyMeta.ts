const FRAME_HEADER = 0xf3;
const FRAME_END = 0xf4;
const PROTOCOL_ID = 0x01;
const DEV_ID = 0x00;
const SRV_ID = 0x5e;
const FILE_HEADER_CMD_ID = 0x01;
const FILE_BLOCK_CMD_ID = 0x02;
const FILE_STATE_CMD_ID = 0xf0;
const FILE_TYPE = 0x00;
const FILE_BLOCK_SIZE = 240;

async function bytesToHexStr(data: Uint8Array): Promise<string> {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

async function calcChecksum(data: Uint8Array): Promise<number> {
  return data.reduce((sum, byte) => sum + byte, 0) & 0xff;
}

async function calc32BitXor(data: Uint8Array): Promise<Uint8Array> {
  const checksum = new Uint8Array(4);
  for (let i = 0; i < Math.floor(data.length / 4); i++) {
    for (let j = 0; j < 4; j++) {
      checksum[j] ^= data[i * 4 + j];
    }
  }
  for (let i = 0; i < data.length % 4; i++) {
    checksum[i] ^= data[Math.floor(data.length / 4) * 4 + i];
  }
  return checksum;
}

export async function prepareFileHeaderFrame(
  inputFileLen: number,
  targetFilePath: string,
  inputFileData: Buffer
): Promise<Buffer> {
  const cmdLenStr = await bytesToHexStr(
    new Uint8Array([
      (0x09 + targetFilePath.length) & 0xff,
      (0x09 + targetFilePath.length) >> 8,
    ])
  );
  const inputFileSizeStr = await bytesToHexStr(
    new Uint8Array([
      inputFileLen & 0xff,
      (inputFileLen >> 8) & 0xff,
      (inputFileLen >> 16) & 0xff,
      (inputFileLen >> 24) & 0xff,
    ])
  );
  const inputFileChecksumStr = await bytesToHexStr(
    await calc32BitXor(inputFileData)
  );
  const inputFileNameStr = await bytesToHexStr(
    Buffer.from(targetFilePath, "utf-8")
  );

  const frameDataStr = `${PROTOCOL_ID.toString(16).padStart(
    2,
    "0"
  )} ${DEV_ID.toString(16).padStart(2, "0")} ${SRV_ID.toString(16).padStart(
    2,
    "0"
  )} ${FILE_HEADER_CMD_ID.toString(16).padStart(
    2,
    "0"
  )} ${cmdLenStr} ${FILE_TYPE.toString(16).padStart(
    2,
    "0"
  )} ${inputFileSizeStr} ${inputFileChecksumStr} ${inputFileNameStr}`;
  const frameDataLen = Buffer.from(
    frameDataStr.replace(/ /g, ""),
    "hex"
  ).length;
  const frameDataLenStr = await bytesToHexStr(
    new Uint8Array([frameDataLen & 0xff, frameDataLen >> 8])
  );
  const frameHeadChecksumStr = await bytesToHexStr(
    new Uint8Array([
      await calcChecksum(
        Buffer.from(
          `${FRAME_HEADER.toString(16).padStart(
            2,
            "0"
          )}${frameDataLenStr.replace(/ /g, "")}`,
          "hex"
        )
      ),
    ])
  );
  const frameChecksumStr = await bytesToHexStr(
    new Uint8Array([
      await calcChecksum(Buffer.from(frameDataStr.replace(/ /g, ""), "hex")),
    ])
  );

  const sendHeadStr = `${FRAME_HEADER.toString(16).padStart(
    2,
    "0"
  )} ${frameHeadChecksumStr} ${frameDataLenStr} ${frameDataStr} ${frameChecksumStr} ${FRAME_END.toString(
    16
  ).padStart(2, "0")}`;

  return Buffer.from(sendHeadStr.replace(/ /g, ""), "hex");
}

export async function prepareFileBlockFrame(
  inputFileData: Buffer,
  fileOffset: number,
  sendFileSize: number
): Promise<Buffer> {
  const fileOffsetStr = await bytesToHexStr(
    new Uint8Array([
      fileOffset & 0xff,
      (fileOffset >> 8) & 0xff,
      (fileOffset >> 16) & 0xff,
      (fileOffset >> 24) & 0xff,
    ])
  );
  const cmdLenStr = await bytesToHexStr(
    new Uint8Array([(0x04 + sendFileSize) & 0xff, (0x04 + sendFileSize) >> 8])
  );
  const fileBlockStr = await bytesToHexStr(
    inputFileData.subarray(fileOffset, fileOffset + sendFileSize)
  );

  const frameDataStr = `${PROTOCOL_ID.toString(16).padStart(
    2,
    "0"
  )} ${DEV_ID.toString(16).padStart(2, "0")} ${SRV_ID.toString(16).padStart(
    2,
    "0"
  )} ${FILE_BLOCK_CMD_ID.toString(16).padStart(
    2,
    "0"
  )} ${cmdLenStr} ${fileOffsetStr} ${fileBlockStr}`;
  const frameDataLen = Buffer.from(
    frameDataStr.replace(/ /g, ""),
    "hex"
  ).length;
  const frameDataLenStr = await bytesToHexStr(
    new Uint8Array([frameDataLen & 0xff, frameDataLen >> 8])
  );
  const frameHeadChecksumStr = await bytesToHexStr(
    new Uint8Array([
      await calcChecksum(
        Buffer.from(
          `${FRAME_HEADER.toString(16).padStart(
            2,
            "0"
          )}${frameDataLenStr.replace(/ /g, "")}`,
          "hex"
        )
      ),
    ])
  );
  const frameChecksumStr = await bytesToHexStr(
    new Uint8Array([
      await calcChecksum(Buffer.from(frameDataStr.replace(/ /g, ""), "hex")),
    ])
  );

  const sendBlockStr = `${FRAME_HEADER.toString(16).padStart(
    2,
    "0"
  )} ${frameHeadChecksumStr} ${frameDataLenStr} ${frameDataStr} ${frameChecksumStr} ${FRAME_END.toString(
    16
  ).padStart(2, "0")}`;

  return Buffer.from(sendBlockStr.replace(/ /g, ""), "hex");
}
