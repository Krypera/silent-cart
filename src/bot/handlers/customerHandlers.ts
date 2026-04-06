import type { Telegraf } from "telegraf";
import type { AppServices } from "../../app/services.js";
import { registerCatalogHandlers } from "../customer/catalogHandlers.js";
import { registerCheckoutHandlers } from "../customer/checkoutHandlers.js";
import { registerGuideHandlers } from "../customer/guideHandlers.js";
import type { BotContext } from "../session.js";

export function registerCustomerHandlers(bot: Telegraf<BotContext>, services: AppServices): void {
  registerCatalogHandlers(bot, services);
  registerCheckoutHandlers(bot, services);
  registerGuideHandlers(bot, services);
}
