import type { Queryable } from "../../db/database.js";
import type { SilentCartStore } from "../store.js";
import { mapSetting, type BotSettingRow, requireRow } from "./shared.js";

export function createSettingsRepository(executor: Queryable): SilentCartStore["settings"] {
  return {
    get: async <T>(key: string) => {
      const result = await executor.query<BotSettingRow>(`select * from bot_settings where key = $1`, [key]);
      return result.rows[0] ? (mapSetting(result.rows[0]).valueJson as T) : null;
    },
    set: async (key, valueJson) => {
      const result = await executor.query<BotSettingRow>(
        `
          insert into bot_settings (key, value_json)
          values ($1, $2::jsonb)
          on conflict (key)
          do update set
            value_json = excluded.value_json,
            updated_at = now()
          returning *
        `,
        [key, JSON.stringify(valueJson)]
      );
      return mapSetting(requireRow(result.rows[0], "setting"));
    },
    delete: async (key) => {
      await executor.query(`delete from bot_settings where key = $1`, [key]);
    }
  };
}
