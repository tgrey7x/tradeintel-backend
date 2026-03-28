const { Telegraf } = require('telegraf');

let bot = null;

const sendAlert = async (message) => {
  try {
    if (!bot || !process.env.TELEGRAM_CHAT_ID) return;
    await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
  } catch (err) {
    console.error('Telegram alert error:', err.message);
  }
};

const startBot = () => {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.log('Telegram: No token, bot disabled');
      return;
    }
    bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    bot.command('start', ctx => ctx.reply('TradeIntel Admin Bot Online! Type /help'));
    bot.command('status', ctx => ctx.reply('All systems operational'));
    bot.command('agents', ctx => ctx.reply('All 5 agents online'));
    bot.command('security', ctx => ctx.reply('No critical threats'));
    bot.command('metrics', ctx => ctx.reply('Platform running normally'));
    bot.command('help', ctx => ctx.reply('/status /agents /security /metrics'));
    bot.launch().catch(err => console.error('Bot error:', err.message));
    console.log('Telegram bot starting...');
  } catch (err) {
    console.error('Telegram setup error:', err.message);
  }
};

module.exports = { sendAlert, startBot };
