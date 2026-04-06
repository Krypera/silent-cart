import type { Queryable } from "../../db/database.js";
import type { SilentCartStore } from "../store.js";
import { mapRetentionLink, type RetentionLinkRow, requireRow } from "./shared.js";

export function createRetentionRepository(executor: Queryable): SilentCartStore["retention"] {
  return {
    create: async (input) => {
      const result = await executor.query<RetentionLinkRow>(
        `
          insert into retention_links (order_id, telegram_user_id, expires_at, purged_at)
          values ($1, $2, $3, $4)
          returning *
        `,
        [input.orderId, input.telegramUserId.toString(), input.expiresAt, input.purgedAt]
      );
      return mapRetentionLink(requireRow(result.rows[0], "retention link"));
    },
    findByOrderId: async (orderId) => {
      const result = await executor.query<RetentionLinkRow>(
        `select * from retention_links where order_id = $1`,
        [orderId]
      );
      return result.rows[0] ? mapRetentionLink(result.rows[0]) : null;
    },
    listByTelegramUserId: async (telegramUserId) => {
      const result = await executor.query<RetentionLinkRow>(
        `
          select * from retention_links
          where telegram_user_id = $1
            and purged_at is null
          order by created_at desc
        `,
        [telegramUserId.toString()]
      );
      return result.rows.map(mapRetentionLink);
    },
    listExpired: async (now) => {
      const result = await executor.query<RetentionLinkRow>(
        `
          select * from retention_links
          where expires_at is not null
            and expires_at <= $1
            and purged_at is null
          order by expires_at asc
        `,
        [now]
      );
      return result.rows.map(mapRetentionLink);
    },
    update: async (orderId, patch) => {
      const fields: string[] = [];
      const params: unknown[] = [orderId];
      let index = 2;

      const setField = (column: string, value: unknown) => {
        fields.push(`${column} = $${index}`);
        params.push(value);
        index += 1;
      };

      if (patch.telegramUserId !== undefined) {
        setField("telegram_user_id", patch.telegramUserId?.toString() ?? null);
      }
      if (patch.expiresAt !== undefined) setField("expires_at", patch.expiresAt);
      if (patch.purgedAt !== undefined) setField("purged_at", patch.purgedAt);

      const result = await executor.query<RetentionLinkRow>(
        `
          update retention_links
          set ${fields.join(", ")}
          where order_id = $1
          returning *
        `,
        params
      );
      return mapRetentionLink(requireRow(result.rows[0], "retention link"));
    }
  };
}
