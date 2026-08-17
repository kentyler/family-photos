import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config);
app.listen(config.port, () => console.log(`Family Photo Archive listening on port ${config.port}`));
