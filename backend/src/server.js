import { app } from "./app.js";
import { env } from "./config/env.js";

app.listen(env.port, () => {
  console.log(`Fahrtenbuch API läuft auf Port ${env.port}`);
});
