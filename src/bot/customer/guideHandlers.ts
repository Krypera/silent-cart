import { Markup, type Telegraf } from "telegraf";
import type { AppServices } from "../../app/services.js";
import type { BotContext } from "../session.js";
import { getMatchValue } from "./common.js";

export function registerGuideHandlers(bot: Telegraf<BotContext>, services: AppServices): void {
  bot.command("guide", async (ctx) => {
    const sections = await services.guideService.getSections();
    await ctx.reply(
      "Monero Guide",
      Markup.inlineKeyboard(
        sections.map((section) => [Markup.button.callback(section.title, `guide:section:${section.key}`)])
      )
    );
  });

  bot.action("guide:open", async (ctx) => {
    await ctx.answerCbQuery();
    const sections = await services.guideService.getSections();
    await ctx.reply(
      "Monero Guide",
      Markup.inlineKeyboard(
        sections.map((section) => [Markup.button.callback(section.title, `guide:section:${section.key}`)])
      )
    );
  });

  bot.action(/^guide:section:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const sectionKey = getMatchValue(ctx.match);
    if (!sectionKey) {
      await ctx.reply("That guide section is not available.");
      return;
    }

    const sections = await services.guideService.getSections();
    const section = sections.find((item) => item.key === sectionKey);
    if (!section) {
      await ctx.reply("That guide section is not available.");
      return;
    }

    await ctx.reply(`${section.title}\n\n${section.body}`);
  });
}
