import type { Queryable } from "../../db/database.js";
import type { SilentCartStore } from "../store.js";
import { mapAdminUser, type AdminUserRow, requireRow } from "./shared.js";

export function createAdminsRepository(executor: Queryable): SilentCartStore["admins"] {
  return {
    syncAllowlist: async (ids) => {
      await executor.query(`delete from admin_users`);
      for (const id of ids) {
        await executor.query(
          `insert into admin_users (telegram_user_id) values ($1) on conflict do nothing`,
          [id.toString()]
        );
      }
    },
    isKnownAdmin: async (telegramUserId) => {
      const result = await executor.query<{ exists: boolean }>(
        `
          select exists(
            select 1 from admin_users where telegram_user_id = $1
          ) as "exists"
        `,
        [telegramUserId.toString()]
      );
      return requireRow(result.rows[0], "admin exists").exists;
    },
    listAll: async () => {
      const result = await executor.query<AdminUserRow>(
        `select * from admin_users order by telegram_user_id asc`
      );
      return result.rows.map(mapAdminUser);
    }
  };
}
