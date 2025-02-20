import { magentaBright, cyan } from 'ansis';
import express from 'express';
import cron from 'node-cron';
import path from 'path';
import App from './app.js';
import Renderer from './render.js';
import CryptoBot from './crypto-bot.js';
import EcaTrader from './strategies/eca-trader.js';
import TradeHistory from './strategies/trade-history.js';
const __dirname = import.meta.dirname;

var bot = new CryptoBot();
process.env.TZ = bot.getLocalSettings().timezone;

const server = express();
var port = bot.getServerPort();
var renderer = new Renderer(bot);

server.use(express.static('web'));
server.use(express.json());
server.use('/css', express.static(path.join(__dirname, '../node_modules/bootswatch/dist/darkly')));

App.server = server.listen(port, () => {
  bot.init();
  (async () => {
    App.log(magentaBright`Crypto-Bot listening on port ${port.toString()}`, true);
    //await bot.rebuildHistory();
    var result = await bot.update();
  })();
});

server.get('/api', async function (req, res) {
  let target = req.query['target'].toString();
  App.log(`/${cyan`${target}[${formatEndpoint(req)}]`}: request from ${req.ip}`, true);

  let endpoint = req.query['endpoint'];
  var response;
  res.setHeader('Content-Type', 'application/json');

  switch (endpoint) {
    case 'Ticker':
      bot.updateTickers(response);
      break;

    case 'ShowSchedule': {
      response = await renderer.renderOrderSchedule();
      break;
    }

    case 'ShowActivePlans': {
      response = await renderer.renderActiveBots();
      break;
    }

    case 'Decide':
      response = await bot.processPlans();
      response = { status: 'success', data: response };
      break;

    case 'Balance': {
      let accountId = req.query['account'].toString();
      response = {
        balances: bot.getClient(accountId).balances,
        html: renderer.renderBalanceBlocks(accountId).html,
      };
      break;
    }

    case 'StartDeal': {
      let botId = req.query['botId'].toString();
      let botSettings = bot.getBotSettings(botId);
      if (botSettings.strategyType === 'trader') {
        var trader = new EcaTrader(bot, botId);
        response = await trader.startDeal();
      }
      break;
    }

    case 'TradeBalance': {
      let botId = req.query['botId'].toString();
      let groupBy = req.query['groupBy'].toString();
      let botSettings = bot.getBotSettings(botId);

      if (botSettings.active && botSettings.strategyType === 'trader') {
        var th = new TradeHistory(bot, botId);
        //await th.analyseOrders(bot.getClient('krakenBot'), botId, { verbose: true, redownload: false, saveTrades: true, saveDeals: true });
        response = { status: 'success', request: endpoint, data: th.calculatePnL(groupBy), chartType: 'traderBot', pair: bot.getBotSettings(botId).pair };
      } else response = { status: 'failed' };
      break;
    }

    case 'PurchaseHistory': {
      let botId = req.query['botId'].toString();
      let purchases = new TradeHistory(bot, botId).reportPurchases(bot.getClient('kraken'));
      let pair = bot.getBotSettings(botId).pair;
      let data = await bot.getClient('kraken').requestCandleData({ pair: pair, interval: req.query['interval'], since: Number(req.query['startDate']) / 1000 });
      response = { status: 'success', pair: pair, request: endpoint, data: data, purchases: purchases, chartType: 'candlestick' };
      break;
    }

    case 'DealPreview': {
      let botId = req.query['botId'].toString();
      let botSettings = bot.getBotSettings(botId);
      if (!botSettings.active) {
        response = {
          status: 'success',
          request: 'endpoint',
          html: `Bot ${botId} is not active.`,
        };
      } else {
        let trader = new EcaTrader(bot, botId);
        var dealResult = trader.dealPlanner.proposeDeal(trader.client.getPrice(botSettings.pair), 4);
        let html = (await renderer.renderOpenDeal(trader.getLatestOpenDeal())).html + renderer.renderPreview(botId, dealResult.orders).html;
        response = {
          status: 'success',
          request: endpoint,
          html: html,
        };
      }
      break;
    }

    case 'ClientSettings': {
      response = { status: 'success', clientSettings: bot.getClientSettings(), traderBotId: bot.getTraderBotIds()[0] };
      break;
    }

    case 'RebuildHistory': {
      await bot.rebuildHistory();
      response = { status: 'success' };
      break;
    }

    default:
      console.debug(response);
      break;
  }

  if (response == null) {
    res.json({ status: 'failed' });
    App.error(`[${endpoint}] no data received`);
    return;
  }

  res.json(response);
});

server.post('/api', async function (req, res) {
  let content = req.body;
  App.log(`/api[${content.request}]: Received from ${req.ip}`);
  var response;

  switch (content.request) {
    default:
      response = { status: 'failed' };
      break;
  }
  res.setHeader('Content-Type', 'application/json');
  res.json(response);
});

cron.schedule('*/30 * * * *', () => {
  try {
    update().then(() => App.writeLog());
  } catch (error) {
    bot.telegramBot.log('Oh no!\n' + error);
    App.log(error);
    App.writeLog();
  }
});

process.on('SIGINT', stopServer);

async function stopServer() {
  console.log('\n');
  App.warning('Exit requested by user');
  App.warning('----- end -----\n');
  App.writeLog();
  bot.saveAllOrders();
  process.exit();
}

async function update() {}

function formatEndpoint(req) {
  let endpoint = `${req.query.endpoint}`;
  if (typeof req.query.params !== 'undefined') endpoint += `/${req.query.params}`;
  return endpoint;
}
