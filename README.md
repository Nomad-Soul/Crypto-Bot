# Crypto-Bot
A Crypto Stacker and Trader Bot
![stackerBot](https://github.com/Nomad-Soul/Crypto-Bot/assets/167021470/20bc0bc6-13a2-472e-99d2-e52157aaeaa1)


## Sample Setting File
In the root folder, create a folder called `json` and add a file named `settings.json`.

Example configuration:
```
{
  "serverPort": 3069,
  "locale": {
    "id": "eu",
    "timezone": "Europe/Rome",
    "currency": "eur"
  },
  "accounts": {
    "kraken": {
      "id": "kraken",
      "publicKey": "your public key",
      "privateKey": "your private key",
      "type": "kraken",
      "active": true,
      "watchBalance": ["btc", "eur"],
      "purchaseHistory": {
        "botId": "btc/eur",
        "pair": "btc/eur",
        "interval": 1440,
        "startDate": "2024-03-05"
      }
    },
  },
  "services": {
    "telegram": {
      "privateKey": "your private key",
      "chatId": your chat id number
    }
  },
  "bots": {
    "bot-eth/eur": {
      "id": "bot-eth/eur",
      "account": "krakenBot",
      "strategy": "eca-trader",
      "crypto": "eth",
      "active": true,
      "pair": "eth/eur",
      "quoteCurrency": "eur",
      "badgeClass": "bg-accent",
      "options": {
        "initialOrderSize": 60,
        "safetyOrder": 60,
        "maxSafetyOrders": 4,
        "priceDeviation": 0.02,
        "safetyOrderStepScale": 1.05,
        "safetyOrderVolumeScale": 1.65,
        "profitTarget": 0.03
      },
      "userref": 1000
    },
    "btc/eur": {
      "id": "btc/eur",
      "account": "kraken",
      "strategy": "eca-stacker",
      "crypto": "BTC",
      "active": true,
      "maxPrice": 61999.69,
      "pair": "btc/eur",
      "quoteCurrency": "eur",
      "badgeClass": "bg-warning",
      "options": {
        "frequency": 16,
        "type": "recurring",
        "maxOrdersPerDay": 1
      },
      "userref": 1,
      "maxVolumeEur": 6
    },
  },
}
