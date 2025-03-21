import axios from 'axios';
import ansis, { cyan, greenBright, yellowBright, magenta, redBright, hex, grey, cyanBright, white, dim, fg } from 'ansis';
import asTable from 'as-table';
import Terminal from '../app/terminal.js';

export default class CoinMarketCapClient {
  #privateKey;

  /**
   * @param {{privateKey: string}} data
   */
  constructor(data) {
    this.#privateKey = data.privateKey;
  }

  /**
   *
   * @param {{tagsInclude?: string[], tagsExclude?: string[], cryptoExclude?: string[], number: number}} options
   * @returns
   */
  async makeRequest(options) {
    let response = null;
    return new Promise(async (resolve, reject) => {
      try {
        response = await axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest', {
          params: {
            start: 1,
            limit: 50,
            convert: 'EUR',
          },
          headers: {
            'X-CMC_PRO_API_KEY': this.#privateKey,
          },
        });
      } catch (ex) {
        response = null;
        // error
        console.log(ex);
        reject(ex);
      }
      if (response) {
        // success
        var term = Terminal.instance;
        const json = response.data;
        resolve(json);
        const topCryptos = response.data.data;
        term.log(`\r\n^GTop ${options.number} Cryptocurrencies by Market Cap:`);
        let output = [];
        let includeEverything = false;
        if (options.tagsInclude.length == 0) {
          includeEverything = true;
        }

        let tagsInclude = options.tagsInclude;
        let tagsExclude = options.tagsExclude;
        let cryptoExclude = options.cryptoExclude;

        topCryptos.forEach((crypto, index) => {
          if (cryptoExclude && cryptoExclude.includes(crypto.symbol)) {
            return;
          }
          if (
            (!includeEverything && tagsInclude && tagsInclude.filter((tag) => crypto.tags.includes(tag)).length == 0) ||
            (tagsExclude && tagsExclude.filter((tag) => crypto.tags.includes(tag)).length > 0)
          ) {
            return;
          }
          let colour = this.#cryptoToColour(crypto);
          let mcapB = String((crypto.quote.EUR.market_cap / 1e9).toFixed(3)).padStart(8, ' ');
          output.push({
            index: index + 1,
            name: `${colour}${crypto.name}`,
            symbol: crypto.symbol,
            mcap: `^W${mcapB}b^ EUR`,
          });
        });

        const table = asTable.configure({
          delimiter: ' ^c|^ ',
          title: (title) => `^G${title.toUpperCase()}^:`,
        })(output.slice(0, options.number));
        term.log(table + '\r\n');
      }
    });
  }

  /**
   *
   * @param {{tags:string[]}} crypto
   * @returns
   */
  #cryptoToColour(crypto) {
    if (crypto.tags.includes('pos')) return '^M';
    if (crypto.tags.includes('stablecoin')) return '^C';
    if (crypto.tags.includes('store-of-value')) return '^Y';
    if (crypto.tags.includes('centralized-exchange')) return '^k';
    if (crypto.tags.includes('layer-1')) return '^R';
    if (crypto.tags.includes('memes')) return '^g';
    if (crypto.tags.includes('ethereum-ecosystem')) return '^m';
    return '^w';
  }
}
