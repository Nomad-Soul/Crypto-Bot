import { magentaBright, cyan } from 'ansis';
import express from 'express';
const server = express();
import cron from 'node-cron';

import App from './app.js';
import Renderer from './render.js';
import CryptoBot from './crypto-bot.js';
import EcaTrader from './strategies/eca-trader.js';
import TradeHistory from './strategies/trade-history.js';
App.log('Starting Crypto-Bot v1.0 by NomadSoul', true, magentaBright);

var bot = new CryptoBot();
var port = bot.getServerPort();
var renderer = new Renderer(bot);

process.env.TZ = bot.getLocalSettings().timezone;

server.use(express.static('web'));
server.use(express.json());

App.server = server.listen(port, () => {
  App.log(magentaBright`Crypto-Bot listening on port ${port.toString()}`, true);

  var pricePromise = bot.updatePricesSync();
  var syncPromise = bot.syncExchangeStatus();

  Promise.all([pricePromise, syncPromise]).then(() => bot.processPlans());
});

server.get('/api', async function (req, res) {
  let target = req.query['target'];
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
      let accountId = req.query['account'];
      response = {
        balances: bot.getClient(accountId).balances,
        html: renderer.renderBalanceBlocks(accountId).html,
      };
      break;
    }

    case 'StartDeal': {
      let botId = req.query['botId'];
      let botSettings = bot.getBotSettings(botId);
      if (botSettings.strategyType === 'eca-trader') {
        var trader = new EcaTrader(bot, botId);
        response = await trader.startDeal();
      }
      break;
    }

    case 'TradeBalance': {
      let botId = req.query['botId'];
      let botSettings = bot.getBotSettings(botId);
      var th = new TradeHistory(bot, botId);

      if (botSettings.strategyType === 'eca-trader') {
        response = { status: 'success', request: endpoint, data: th.calculatePnL(), chartType: 'traderBot', pair: bot.getBotSettings(botId).pair };
      } else response = { status: 'failed' };
      break;
    }

    case 'PurchaseHistory': {
      let botId = req.query['botId'];
      let purchases = new TradeHistory(bot, botId).reportPurchases(bot.getClient('kraken'));
      let pair = bot.getBotSettings(botId).pair;
      //console.log(purchases);
      let data = await bot.getClient('kraken').requestCandleData({ pair: pair, interval: req.query['interval'], since: Number(req.query['startDate']) / 1000 });
      response = { status: 'success', pair: pair, request: endpoint, data: data, purchases: purchases, chartType: 'candlestick' };
      break;
    }

    case 'DealPreview': {
      let botId = req.query['botId'];
      let trader = new EcaTrader(bot, botId);
      let pair = bot.getBotSettings(botId).pair;
      var dealResult = trader.dealPlanner.proposeDeal(bot.getPrice(pair), 4);
      response = {
        status: 'success',
        request: endpoint,
        html: renderer.renderOpenDeal(trader.getLatestOpenDeal()).html + renderer.renderPreview(botId, dealResult.orders).html,
      };
      break;
    }

    case 'ClientSettings': {
      response = { status: 'success', clientSettings: bot.getClientSettings(), traderBotId: bot.getTraderBotIds()[0] };
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
    bot.updatePricesSync().then(() => bot.processPlans());
    App.writeLog();
  } catch (error) {
    bot.telegramBot.log('Oh no!\n' + error);
    App.log(error);
    App.writeLog();
  }
});

process.on('SIGINT', stopServer);

async function stopServer() {
  console.log('\n');
  App.warning('Exit request by user');
  App.warning('----- end -----\n');
  App.writeLog();
  bot.saveAllOrders();
  process.exit();
}

function formatEndpoint(req) {
  let endpoint = `${req.query.endpoint}`;
  if (typeof req.query.params !== 'undefined') endpoint += `/${req.query.params}`;
  return endpoint;
}
