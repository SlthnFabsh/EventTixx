import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import routes from "./routes";
import { errorHandler } from "./middlewares/errorHandler.middleware";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api", routes);

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
