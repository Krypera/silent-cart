import { bootstrap } from "./app/bootstrap.js";

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
