const networkId = {
    baseGoerli: 84531,
    develop: 1112,
    hardhat: 31337,
}

const priceFeedApi = 'https://api.xoracle.io/prices/priceFeed/'

const priceFeedSigners = [
    '0xA2cE39faC6201ff9998A43f5f0B57f0908aF7b13',
    '0xC858e868D3644Abd2b04217b3c4F52C396f4e181',
    '0x9CC224EE6EA90d52E0a82893A7aB466E2a10F25B',
    '0xf781FC2f7D12EdbbE439221eD38DDF6f26215FFc',
]

const tokenIndexes = {
    BTC: 0,
    ETH: 1,
    BNB: 2,
    USDT: 3,
    BUSD: 4,
    USDC: 5,
    DAI: 6,
    XRP: 10,
    DOGE: 11,
    TRX: 12,
    ADA: 20,
    MATIC: 21,
    SOL: 22,
    DOT: 23,
    AJAX: 24,
    FTM: 25,
    NEAR: 26,
    ATOM: 27,
    OP: 28,
    ARB: 29,
}

const config = {
    84531: {
        // baseGoerli
        // address signer
        deployer: '0x41BC7208d03a38FD6AA29057648019C4e93049b6', // signer1
        signer2: '0xC2829C12c1Ca8D700A9C94Da66d241E1790a900C',
        signer3: '0xc3ec961EECB978bca30A75f9f756bBAB5e36B532',
        keeper: '0xC1442936F623Ae86c45Bd29FeB22f2208A0d9A4B',
        liquidator: '0xE8C342054490501E5dA6a722bE4360F6cadD12BF',

        // fees
        feeReceiver: '0x41c6Ad25a673673A53c6CFA615379C473275D4CA', // execute fee
        mintReceiver: '0xA2cE39faC6201ff9998A43f5f0B57f0908aF7b13',

        // weth
        weth: '0x6c4eE95dfE63b13e6f3FaBd0Cbca81D41FF8f87f',

        // miOracle price feed
        miOracle_logic: '0x0afa2725ca60c7b0bfD487e1636e4DFD9d5B8229',
        miOracle: '0x4718BbCaE6422a63Ff5F8421d38Ab447594675cb',
        btcPriceFeed: '0xaFC4cfba8232034cD783d8F518C6947b9147eD1b',
        ethPriceFeed: '0x54D67881162ccD0D4DA78c1d021bCe9E5DFf3A11',
        bnbPriceFeed: '0x54e250Afce1B84f5B2c2Bf649d19E16Cfd9d1304',
        usdtPriceFeed: '0x0A9267aDa8B601912fCb532B9831f9125B885069',
        busdPriceFeed: '0x22085aCD1997dCfD9E79778B28444089C13806e9',
        usdcPriceFeed: '0xC32BA6DAd4AE0087F9eA5ed9081223b5f7367ABB',
        daiPriceFeed: '0xe1a533CA9a6c23E5C8f88524CECf1a72724347B6',
        xrpPriceFeed: '0xd8949FfdeA846B51e32896a35f1173a37A6DfC7A',
        dogePriceFeed: '0xa59fB765bD014699e7f486D96c87681eEA6aB7b4',
        trxPriceFeed: '0x9d8B82a6e7041864c29882C1A7A1E9F5cAFF5584',
        adaPriceFeed: '0x0952632d53916FE42344aa0a811608d816856088',
        maticPriceFeed: '0x32dba02d1cBd37c163cEc1250fBf2f638039c7a7',
        solPriceFeed: '0xF9AF74Be2cbA0B004391dEec48EA29694f59409a',
        dotPriceFeed: '0x1CE24BBed732a271355c13d82235407800baF18C',
        linkPriceFeed: '0xf66f0A2b5c7311ffcf1c07F3cd6EE405ac3c6D28',
        ftmPriceFeed: '0xc01C8DFb1e5078c6b9B00F220dc5A6Bb0648A6e0',
        nearPriceFeed: '0x637222144aAE7E788344bB612AaBAdEf0EF3e06b',
        atomPriceFeed: '0xd1e0923500A4D161e5469DF1fD2AE1D49e06E644',
        opPriceFeed: '0xbF96Eaf8D7Eafe4c7624Ed98E49Efd30C74121d0',
        arbPriceFeed: '0xecB5732DC7370aC7e7350e9A1ea21eC1f3A529Dd',
    },
    1112: {
        // develop
        // address signer
        deployer: '0x11114D88d288c48Ea5dEC180bA5DCC2D137398dF', // signer1
        signer2: '0x666634e72c4948c7CB3F7206D2f731A34e076469',
        signer3: '0x9103c4B112ec249a34aB7AdD9D5589Ca4DF36Aaa',
        keeper: '0x6C56eddb37a8d38f1bDeB33360A7f875eAB75c20',
        liquidator: '0x6C56eddb37a8d38f1bDeB33360A7f875eAB75c20',

        // fees
        feeReceiver: '0x9103c4B112ec249a34aB7AdD9D5589Ca4DF36Aaa', // execute fee
        mintReceiver: '0x9103c4B112ec249a34aB7AdD9D5589Ca4DF36Aaa',

        // weth
        weth: '0x078c04b8cfC949101905fdd5912D31Aad0a244Cb',

        // miOracle price feed
        MiOracle_logic: '0x0afa2725ca60c7b0bfD487e1636e4DFD9d5B8229',
        MiOracle: '0x4718BbCaE6422a63Ff5F8421d38Ab447594675cb',
        btcPriceFeed: '0xaFC4cfba8232034cD783d8F518C6947b9147eD1b',
        ethPriceFeed: '0x54D67881162ccD0D4DA78c1d021bCe9E5DFf3A11',
        bnbPriceFeed: '0x54e250Afce1B84f5B2c2Bf649d19E16Cfd9d1304',
        usdtPriceFeed: '0x0A9267aDa8B601912fCb532B9831f9125B885069',
        busdPriceFeed: '0x22085aCD1997dCfD9E79778B28444089C13806e9',
        usdcPriceFeed: '0xC32BA6DAd4AE0087F9eA5ed9081223b5f7367ABB',
        daiPriceFeed: '0xe1a533CA9a6c23E5C8f88524CECf1a72724347B6',
        xrpPriceFeed: '0xd8949FfdeA846B51e32896a35f1173a37A6DfC7A',
        dogePriceFeed: '0xa59fB765bD014699e7f486D96c87681eEA6aB7b4',
        trxPriceFeed: '0x9d8B82a6e7041864c29882C1A7A1E9F5cAFF5584',
        adaPriceFeed: '0x0952632d53916FE42344aa0a811608d816856088',
        maticPriceFeed: '0x32dba02d1cBd37c163cEc1250fBf2f638039c7a7',
        solPriceFeed: '0xF9AF74Be2cbA0B004391dEec48EA29694f59409a',
        dotPriceFeed: '0x1CE24BBed732a271355c13d82235407800baF18C',
        linkPriceFeed: '0xf66f0A2b5c7311ffcf1c07F3cd6EE405ac3c6D28',
        ftmPriceFeed: '0xc01C8DFb1e5078c6b9B00F220dc5A6Bb0648A6e0',
        nearPriceFeed: '0x637222144aAE7E788344bB612AaBAdEf0EF3e06b',
        atomPriceFeed: '0xd1e0923500A4D161e5469DF1fD2AE1D49e06E644',
        opPriceFeed: '0xbF96Eaf8D7Eafe4c7624Ed98E49Efd30C74121d0',
        arbPriceFeed: '0xecB5732DC7370aC7e7350e9A1ea21eC1f3A529Dd',
    },
    31337: {
        // baseGoerli
        // address signer
        deployer: '0x41BC7208d03a38FD6AA29057648019C4e93049b6', // signer1
        signer2: '0xC2829C12c1Ca8D700A9C94Da66d241E1790a900C',
        signer3: '0xc3ec961EECB978bca30A75f9f756bBAB5e36B532',
        keeper: '0xC1442936F623Ae86c45Bd29FeB22f2208A0d9A4B',
        liquidator: '0xE8C342054490501E5dA6a722bE4360F6cadD12BF',

        // fees
        feeReceiver: '0x41c6Ad25a673673A53c6CFA615379C473275D4CA', // execute fee
        mintReceiver: '0xA2cE39faC6201ff9998A43f5f0B57f0908aF7b13',

        // weth
        weth: '0x6c4eE95dfE63b13e6f3FaBd0Cbca81D41FF8f87f',

        // miOracle price feed
        miOracle_logic: '0x0afa2725ca60c7b0bfD487e1636e4DFD9d5B8229',
        miOracle: '0x4718BbCaE6422a63Ff5F8421d38Ab447594675cb',
        btcPriceFeed: '0xaFC4cfba8232034cD783d8F518C6947b9147eD1b',
        ethPriceFeed: '0x54D67881162ccD0D4DA78c1d021bCe9E5DFf3A11',
        bnbPriceFeed: '0x54e250Afce1B84f5B2c2Bf649d19E16Cfd9d1304',
        usdtPriceFeed: '0x0A9267aDa8B601912fCb532B9831f9125B885069',
        busdPriceFeed: '0x22085aCD1997dCfD9E79778B28444089C13806e9',
        usdcPriceFeed: '0xC32BA6DAd4AE0087F9eA5ed9081223b5f7367ABB',
        daiPriceFeed: '0xe1a533CA9a6c23E5C8f88524CECf1a72724347B6',
        xrpPriceFeed: '0xd8949FfdeA846B51e32896a35f1173a37A6DfC7A',
        dogePriceFeed: '0xa59fB765bD014699e7f486D96c87681eEA6aB7b4',
        trxPriceFeed: '0x9d8B82a6e7041864c29882C1A7A1E9F5cAFF5584',
        adaPriceFeed: '0x0952632d53916FE42344aa0a811608d816856088',
        maticPriceFeed: '0x32dba02d1cBd37c163cEc1250fBf2f638039c7a7',
        solPriceFeed: '0xF9AF74Be2cbA0B004391dEec48EA29694f59409a',
        dotPriceFeed: '0x1CE24BBed732a271355c13d82235407800baF18C',
        linkPriceFeed: '0xf66f0A2b5c7311ffcf1c07F3cd6EE405ac3c6D28',
        ftmPriceFeed: '0xc01C8DFb1e5078c6b9B00F220dc5A6Bb0648A6e0',
        nearPriceFeed: '0x637222144aAE7E788344bB612AaBAdEf0EF3e06b',
        atomPriceFeed: '0xd1e0923500A4D161e5469DF1fD2AE1D49e06E644',
        opPriceFeed: '0xbF96Eaf8D7Eafe4c7624Ed98E49Efd30C74121d0',
        arbPriceFeed: '0xecB5732DC7370aC7e7350e9A1ea21eC1f3A529Dd',
    },
}

module.exports = { networkId, tokenIndexes, config, priceFeedApi, priceFeedSigners }
