"use strict";

const fs = require("node:fs");
const originalFetch = global.fetch;

global.fetch = async function mockedGmailFetch(input, options) {
  const url = String(input);
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
    return new Response(JSON.stringify({ emailAddress: process.env.TEST_GMAIL_EMAIL }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
    fs.writeFileSync(process.env.TEST_GMAIL_CAPTURE_PATH, String(JSON.parse(options.body).raw));
    return new Response(JSON.stringify({ id: "mock-message" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  return originalFetch(input, options);
};
