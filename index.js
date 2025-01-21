const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
// const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Welcome to the Student Scholarship Management Website!");
});

app.listen(port, () => {
  console.log(
    `Scholarship Management System Website app listening on port ${port}`
  );
});
