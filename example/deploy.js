const path = require('path');
const deployer = require('../index');

let cfg = {
  network: 'testnet', // 'mainnet' or 'testnet'
  wanNodeURL: 'http://gwan-testnet.wandevs.org:36891',
  privateKey: 'your-private-key',
  contractDir: path.join(path.dirname(__filename), 'contracts'),
  outputDir: '',
  gasPrice: 180000000000,
  gasLimit: 8000000
}

deployer.config(cfg);

deploy();

async function deploy() {
  try {
    // deploy a lib
    await deployer.deploy('Secp256k1');

    // deploy a contract which linked a lib
    deployer.compile('SchnorrVerifier');
    deployer.link('SchnorrVerifier', 'Secp256k1');
    let contract = await deployer.deploy('SchnorrVerifier');
    console.log("SchnorrVerifier address: %s", contract.address);

    // deploy a contract has constructor with parameters
    let tokenName = 'WRC20 BTC';
    let tokenSymbol = 'WBTC';
    let tokenDecimal = 8;
    await deployer.deploy('WanToken', tokenName, tokenSymbol, tokenDecimal);

    // send transaction to contract
    contract = deployer.deployed('WanToken');
    let initialSupply = 2100000000000000;
    let txData = await contract.methods.mint(contract.address, initialSupply).encodeABI();
    await deployer.sendTx(contract.address, txData);
  } catch (err) {
    console.error("deploy failed: %O", err);
  }
}