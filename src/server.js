require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { ApolloServer } = require("@apollo/server");
const { expressMiddleware } = require("@apollo/server/express4");
const {
  ApolloServerPluginLandingPageLocalDefault,
} = require("@apollo/server/plugin/landingPage/default");
const typeDefs = require("./graphql/typeDefs");
const resolvers = require("./graphql/resolvers");
const rateLimiter = require("./middleware/rateLimiter");
const { verifyAccessToken } = require("./config/jwt");
const { graphqlUploadExpress } = require("graphql-upload");
const path = require("path");
const morgan = require("morgan");

async function startServer() {
  const app = express();
  app.use(
    cors({
      origin: [
        "http://localhost:3000",
        "https://dhwaniastro.com",
        "https://dhwani-new-vercel.vercel.app",
      ],
      credentials: true,
    }),
  );
  app.use(
    "/uploads",
    require("express").static(path.join(__dirname, "uploads")),
  );
  app.use(
    "/profile/uploads",
    express.static(path.join(__dirname, "uploads", "profile")),
  );
  app.use(graphqlUploadExpress({ maxFileSize: 10000000, maxFiles: 1 }));
  app.use(cookieParser());
  app.use(express.json());
  app.use(
    morgan(":date[iso] :method :url :status :response-time ms - :remote-addr"),
  );
  app.use(rateLimiter);
  console.log("testing");
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    csrfPrevention: false,
    plugins: [ApolloServerPluginLandingPageLocalDefault()],
  });

  await server.start();

  app.use(
    "/graphql",
    expressMiddleware(server, {
      context: async ({ req, res }) => {
        const token = req.cookies?.accessToken;

        let user = null;

        if (token) {
          try {
            user = verifyAccessToken(token);
          } catch (e) {
            console.log("JWT Error:", e.message);
          }
        }

        return { req, res, user };
      },
    }),
  );

  const PORT = process.env.PORT || 4000;

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/graphql`);
  });
}

startServer();
