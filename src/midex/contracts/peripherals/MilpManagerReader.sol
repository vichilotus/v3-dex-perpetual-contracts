// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import '../core/interfaces/IVault.sol';

interface IMilpManager {
    function aumAddition() external view returns (uint256);

    function aumDeduction() external view returns (uint256);
}

contract MILPManagerReader {
    struct LastPrice {
        address token;
        uint256 price;
    }

    function getAum(address milpManager, address vault, LastPrice[] memory lastPrice) external view returns (uint256) {
        uint256 length = IVault(vault).allWhitelistedTokensLength();
        uint256 aum = IMilpManager(milpManager).aumAddition();
        uint256 shortProfits = 0;

        for (uint256 i = 0; i < length; i++) {
            address token = IVault(vault).allWhitelistedTokens(i);
            bool isWhitelisted = IVault(vault).whitelistedTokens(token);

            if (!isWhitelisted) {
                continue;
            }

            uint256 price = getPrice(lastPrice, token);
            uint256 poolAmount = IVault(vault).poolAmounts(token);
            uint256 decimals = IVault(vault).tokenDecimals(token);

            if (IVault(vault).stableTokens(token)) {
                aum = aum + ((poolAmount * price) / (10 ** decimals));
            } else {
                // add global short profit / loss
                uint256 size = IVault(vault).globalShortSizes(token);
                if (size > 0) {
                    uint256 averagePrice = IVault(vault).globalShortAveragePrices(token);
                    uint256 priceDelta = averagePrice > price ? averagePrice - price : price - averagePrice;
                    uint256 delta = (size * priceDelta) / averagePrice;
                    if (price > averagePrice) {
                        // add losses from shorts
                        aum = aum + delta;
                    } else {
                        shortProfits = shortProfits + delta;
                    }
                }

                aum = aum + IVault(vault).guaranteedUsd(token);

                uint256 reservedAmount = IVault(vault).reservedAmounts(token);
                aum = aum + (((poolAmount - reservedAmount) * price) / (10 ** decimals));
            }
        }

        aum = shortProfits > aum ? 0 : aum - shortProfits;
        return IMilpManager(milpManager).aumDeduction() > aum ? 0 : aum - IMilpManager(milpManager).aumDeduction();
    }

    function getPrice(LastPrice[] memory lastPrice, address token) private pure returns (uint256) {
        for (uint256 i = 0; i < lastPrice.length; i++) {
            if (lastPrice[i].token == token) {
                return lastPrice[i].price;
            }
        }
        return 0;
    }
}
