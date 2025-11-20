# Polymesh Adapter

Tracks Total Value Locked (TVL) on the Polymesh blockchain.

## Methodology

This adapter calculates TVL by aggregating:
- **Staked POLYX**: Tokens locked in the Proof-of-Stake consensus mechanism
- **Treasury Holdings**: Governance-locked protocol funds (when configured)

Data is fetched directly from Polymesh mainnet using the Polymesh SDK and underlying Polkadot.js API.

## Price Feeds

POLYX/USD prices are fetched from CoinGecko API with a fallback mechanism if the API is unavailable.

## Configuration

Environment variables:
- `POLYMESH_RPC`: Custom RPC endpoint (default: `wss://mainnet-rpc.polymesh.network/`)
- `DEMO_MODE`: Set to `"true"` for testing with mock data
- `SILENT_MODE`: Set to `"true"` to suppress informational logs

## Technical Details

- **Chain**: Polymesh Mainnet
- **Launch Date**: December 16, 2021
- **Native Token**: POLYX (6 decimals)
- **RPC Endpoint**: `wss://mainnet-rpc.polymesh.network/`

## Dependencies

- `@polymeshassociation/polymesh-sdk`: Official Polymesh SDK
- `axios`: HTTP client for price API calls

## Links

- [Polymesh Website](https://polymesh.network/)
- [Polymesh SDK Docs](https://developers.polymesh.network/sdk-docs/)
- [Polymesh GitHub](https://github.com/PolymeshAssociation)
