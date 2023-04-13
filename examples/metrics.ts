import { CycleTime } from "../index.js";
const service = new CycleTime({
  org: process.env.GITHUB_ORG,
  token: process.env.GITHUB_TOKEN,
});

(async () => {
  const data = await service.tickets();
  const metrics = service.metrics(data);

  console.log(metrics);
})();
