wanchain-sc-sdk
========

SDK for deploying smart contracts on Wanchain.

## Installation
Use NPM or Yarn to install the package:
```bash
npm install --save wanchain-sc-sdk
```
## Configuration

Before deploying smart contracts, some config items are required.

<li>network</li>

Choose to deploy on "mainnet" or "testnet", default is mainnet.

<li>nodeURL</li>

Wanchain node for web3 to connect and send transactions, http and wss connections are supported, default is iWan.

<li>privateKey</li>

Private key of deployer. No default.

<li>contractDir</li>

Contracts source code directory, it should be absolute path, can include subfolders. No default.

<li>outputDir</li>

Directory to output deployment information, it should be absolute path, default is homedir of user.

<li>gasPrice</li>

Default is 180 Gwin.

<li>gasLimit</li>

Default is 8 million.

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

Step 2: Import wanchain-sc-sdk package.

```javascript
const deployer = require('wanchain-sc-sdk');
```

Step 3: Config the deployer.

```javascript
const cfg = {
  privateKey: 'your-private-key',
  contractDir: 'contracts-directory',
  ......
}
deployer.config(cfg);
```
Step 4: Compose deployment scripts.

[example](https://github.com/wanchain/wanchain-sc-sdk/blob/master/example/deploy.js)

Step 5: Start to deploy.

```bash
node deploy.js
```