# Crypto-Bot

![stackerBot](https://github.com/Nomad-Soul/Crypto-Bot/assets/167021470/20bc0bc6-13a2-472e-99d2-e52157aaeaa1)

This is a simple Crypto Stacker and Trader Bot that I developed as a personal project. You can freely use it for your own purposes as you see fit. _The author is not liable for any financial gains or losses derived from its use._

# What it is

It supports two main strategies: `eca-stacker` and `eca-trader`, from "Euro Cost Averaging" (as the bot was originally developed to target Euro pairs).

- `eca-stacker` buys a crypto of your choice at a customisable frequency, either expressed in hours or monthly by indicating a preferred day each month.
- `eca-trader` is a trader bot that buys at a desired price and sells at a desired target profit percentage. It uses increasing limit buy orders to decrease its cost basis in case the market goes down.

You can add as many different `eca-stacker` bots as you like. Currently only one `eca-trader` bot is supported in the web interface. The trader bot must be activated manually.

Features:

- Customisable ECA/DCA strategies
- Customisable charts
- Telegram interface bot

It supports the following exchanges:

- Kraken (also supports allocation & deallocation)
- Coinbase

## Installation

1. Clone the repository to your own machine or private server. You need NodeJs installed.
2. In the root folder, rename the file named `json/sample-settings.json` to `json/settings.json`. See a sample here [here](json/sample-settings.json).
3. Run with `node src/server.js`
4. You must ensure it has enough real funds to work with. Start small!

## Documentation

The `settings.json` file has this structure:

- Local parameters (such as server port, locale and app-wide currency choice)
- a list of accounts
- a list of bots

### Account parameters

```json
  "kraken": {
    "id": "kraken",
    "publicKey": "your public key",
    "privateKey": "your private key",
    "type": "kraken",
    "active": true,
    "watchBalance": ["btc", "eur"],
    "[chartType]": { }
  }
```

- `publicKey` and `privateKey`: you need to create your own API keys on the exchange and past them in the appropriate fields.
- `type`: which exchange this account refers to. Use either: `kraken` or `coinbase`
- `watchBalance`: which balances you want to be shown in the web interface.
- `[chartType]`: parameters for charts to visualise, TBA

### Bot parameters

```json
  "stacker-btc": {
    "id": "stacker-btc",
    "account": "kraken",
    "strategy": "eca-stacker",
    "pair": "btc/eur",
    "base": "btc",
    "quote": "eur",
    "active": true,
    "maxPrice": 61999.69,
    "badgeClass": "bg-warning",
    "maxVolumeQuote": 6,
    "userref": 1000,
    "options": {}
  }
```

- `account`: must refer to an account object defined previously.
- `strategy`: currently either `eca-stacker` or `eca-trader`
- `crypto`, `quoteCurrency` and `pair` refer to the asset pair this bot will target.
- `active`: whether this bot is active or not.
- `maxPrice`: max price (in terms of quote currency) it buy at. **Note:** currently a stacker bot will place a limit order if price is above `maxPrice` and then at 23:30 if the order has not been filled, it will buy replace that with a market order.
- `badgeClass`: the background css class to show in the list of orders
- `options`: depend on which strategy you are using
- `userref`: an integer to use as local reference when submitting an order to an exchange

For `eca-stacker`, the following will buy every 16 hours (unless the current price is above `maxPrice`)

```json
  "options": {
    "type": "recurring",
    "frequency": 16,
    "maxOrdersPerDay": 1
  }
```

The following will buy every month on the saturday closest to the 15th (currently only Mondays and Saturdays are supported):

```json
  "options": {
    "type": "monthly",
    "day": 15,
    "option": "closest-saturday"
  },
```

---

![image](https://github.com/Nomad-Soul/Crypto-Bot/assets/167021470/7500b325-f2bd-4e96-a4cd-a9a08b5a7ccf)

For `eca-trader` these options configure your trade:

```json
  "options": {
    "initialOrderSize": 60,
    "safetyOrder": 60,
    "maxSafetyOrders": 4,
    "priceDeviation": 0.02,
    "safetyOrderStepScale": 1.05,
    "safetyOrderVolumeScale": 1.65,
    "profitTarget": 0.03
  },
```

- `initialOrderSize`: the amount of crypto to buy at market (in quote currency, e.g. Euros)
- `safetyOrder`: how much more to buy with your first limit order (in quote currency, e.g. Euros)
- `maxSafetyOrders`: how many limit buy orders to calculate
- `priceDeviation`: the decrease percentage at which to place a limit buy order
- `safetyOrderStepScale`: how much to multiply the `priceDeviation` of each successive limit buy order
- `safetyOrderVolumeScale`: how much more crypto to buy at each successive limit buy order
- `profitTarget`: your desired profit target percentage at which a limit sell order will be placed, including accrued fees
