import { CycleTime } from "../index.js";
const service = new CycleTime({
  org: process.env.GITHUB_ORG,
  token: process.env.GITHUB_TOKEN,
});

service
  .tickets()
  .then((tickets) => console.log("tickets:\n", tickets))
  .catch((error) => console.error(error));
