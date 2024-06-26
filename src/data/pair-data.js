import App from '../app.js';

export default class PairData {
  id;
  base;
  quote;
  minVolume;
  maxQuoteDigits;
  maxBaseDigits;
  minBaseDisplayDigits;
  nativeBaseId;
  nativeQuoteId;

  static alias = new Map([
    ['xxbtzeur', 'btc/eur'],
    ['xethzeur', 'eth/eur'],
    ['etheur', 'eth/eur'],
    ['xxrpzeur', 'xrp/eur'],
    ['xbteur', 'btc/eur'],
    ['xrpeur', 'xrp/eur'],
    ['xdgeur', 'doge/eur'],
    ['neareur', 'near/eur'],
    ['maticeur', 'matic/eur'],
    ['SOL-EUR', 'sol/eur'],
    ['AVAX-EUR', 'avax/eur'],
    ['ETH-EUR', 'eth/eur'],
    ['DOGE-EUR', 'doge/eur'],
    ['LINK-EUR', 'link/eur'],
    ['DOT-EUR', 'dot/eur'],
    ['ADA-EUR', 'ada/eur'],
  ]);

  constructor(data) {
    this.id = data.id;
    this.base = data.base;
    this.quote = data.quote;
    this.minVolume = data.minVolume;
    this.maxQuoteDigits = data.maxQuoteDigits;
    this.maxBaseDigits = data.maxBaseDigits;
    this.minBaseDisplayDigits = data.minBaseDisplayDigits;
    this.nativeBaseId = data.nativeBaseId;
    this.nativeQuoteId = data.nativeQuoteId;
  }

  static Get(pair) {
    if (!PairData.Has(pair)) {
      App.warning(`Invalid pair: ${pair}`);
      var e = new Error();
      console.log(e.stack);
      return 'undefined';
    }

    return PairData.alias.get(pair);
  }

  static Has(pair) {
    return PairData.alias.has(pair);
  }

  static GetAliasCurrency(currency) {
    switch (currency.toLowerCase()) {
      case 'xxbt':
        return 'btc';

      case 'xeth':
      case 'eth2':
        return 'eth';

      case 'xxdg':
        return 'doge';

      case 'zeur':
        return 'eur';

      case 'xxrp':
        return 'xrp';

      default:
        return currency.toLowerCase();
    }
  }
}
