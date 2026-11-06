// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";

/// @notice Fixed-rate SwapRouter02 stand-in for local tests. Pre-fund it with tokenOut.
contract MockSwapRouter02 {
    /// @dev tokenOut base units per 1e6 tokenIn base units (i.e. WBT wei per 1 USDT).
    uint256 public rate;

    constructor(uint256 rate_) {
        rate = rate_;
    }

    function setRate(uint256 rate_) external {
        rate = rate_;
    }

    function exactInputSingle(ISwapRouter02.ExactInputSingleParams calldata p)
        external
        payable
        returns (uint256 amountOut)
    {
        require(IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn), "transferFrom failed");
        amountOut = (p.amountIn * rate) / 1e6;
        require(amountOut >= p.amountOutMinimum, "Too little received");
        address to = p.recipient == address(2) ? address(this) : p.recipient;
        require(IERC20(p.tokenOut).transfer(to, amountOut), "transfer failed");
    }

    function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results) {
        require(block.timestamp <= deadline, "Transaction too old");
        results = new bytes[](data.length);
        for (uint256 i; i < data.length; ++i) {
            (bool ok, bytes memory r) = address(this).delegatecall(data[i]);
            if (!ok) {
                assembly {
                    revert(add(r, 32), mload(r))
                }
            }
            results[i] = r;
        }
    }
}
