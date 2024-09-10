# Firefly vsCode Extension

this is the VSCode Extension for Uploading code to firefly-compateble mainboard from makeblock

## Features

- connecting to the mainboard
- uploading python file to the mainboard

## Requirements

> node-serialport

that's it!

## Known Issues

upload sometimes throw random device timeout error, just upload again

## Release Notes

### 1.0.2

Improve error handling,  
User can now unplug device while uploading, 
unexpected device disconnection is now properly handled
added ability to cancel upload (if you cancel you have to upload again for the code to run at all)

### 1.0.1

Improve the loading bar to the upload progress

### 1.0.0

Initial release of Firefly vsCode Extension  
firt important feature working

**Enjoy!**
