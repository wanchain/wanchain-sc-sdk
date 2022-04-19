tron-sc-sdk
========

SDK for deploying smart contracts on Tron.

## Installation
Use NPM or Yarn to install the package:
```bash
npm install --save tron-sc-sdk
```
## Configuration

Before deploying smart contracts, some config items are required.

<li>nodeURL</li>

Tron node for tronWeb to connect and send transactions, http and wss connections are supported, default is iWan.

<li>privateKey</li>

Private key of deployer. No default.

<li>contractDir</li>

Contracts source code directory, it should be absolute path, can include subfolders. No default.

<li>outputDir</li>

Directory to output deployment information, it should be absolute path, default is homedir of user.

## APIs

<li>config</li>

Config SDK. 

<li>compile</li>

Compile a contract, can be skipped if contract name is consistent with it's source file name and not need to link any library.

<li>link</li>

Link libraries to a contract, can be skipped if not need to link any library.

<li>deploy</li>

Deploy a contract.

<li>sendTx</li>

Send a transaction to contract.

<li>deployed</li>

Get a instance of contract which is deployed before.

## Usage

Step 1: Create a deployment script file, deploy.js for example.

Step 2: Import tron-sc-sdk package.

```javascript
const deployer = require('tron-sc-sdk');
```

Step 3: Config the deployer.

```javascript
const cfg = {
  privateKey: 'your-private-key',
  contractDir: 'abi-directory',
  ......
}
deployer.config(cfg);
```
Step 4: Compose deployment scripts.

[example](https://github.com/zhwir/tron-sc-sdk/blob/master/example/deploy.js)

Step 5: Start to deploy.

```bash
node deploy.js
```