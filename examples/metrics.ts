import { CycleTime } from "../index.js";
const service = new CycleTime({
  org: process.env.GITHUB_ORG,
  token: process.env.GITHUB_TOKEN,
});

service
  .metrics()
  .then((metrics) => console.log("metrics:\n", metrics))
  .catch((error) => console.error(error));
