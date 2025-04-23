import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { TwitterApi } from 'twitter-api-v2';

dotenv.config();

const twitterClient = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_KEY_SECRET,
    accessToken: process.env.ACCESS_TOKEN,
    accessSecret: process.env.ACCESS_TOKEN_SECRET,
  });


const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const headers = { Authorization: `Bearer ${BEARER_TOKEN}` };

const userHandles = ['AzoniNFT'];
const lastSeenFile = './lastSeen.json';
const userIdFile = './userIds.json';
const POLL_INTERVAL_MS = 60 * 1000;

let lastSeen = {};
let userIds = {};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms * 1000));
}
async function generateQuote(tweetText) {
  try {
    const prompt = `
    You are a crypto trader who reads news and market sentiment daily.
    Analyze this tweet and write a quote tweet that casually gives insight — such as why the market is green (e.g., recent ETF approval, CPI numbers, whale activity) or why it might reverse. Use real logic, but be conversational.
    
    Tweet: "${tweetText}"
    `;
    const res = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a calm, clever crypto trader who explains short-term market sentiment and shares observations like you'd post on Twitter — casually but insightfully."
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 100
      });

      return res.choices[0].message.content.trim();

  } catch (err) {
    console.error("❌ GPT error:", err.message);
    return null;
  }
}
async function postQuote(tweetId, quoteText) {
    try {
      const url = `https://twitter.com/i/web/status/${tweetId}`;
      const fullText = `${quoteText}\n\n${url}`;
  
      await twitterClient.v2.tweet(fullText);
      console.log('✅ Quote tweet posted!');
    } catch (err) {
      console.error("❌ Error posting quote tweet:", err.message);
    }
  }
  
// Load cached data
try {
  if (fs.existsSync(lastSeenFile)) {
    lastSeen = JSON.parse(fs.readFileSync(lastSeenFile));
    console.log('✅ Loaded last seen tweet IDs.');
  }
  if (fs.existsSync(userIdFile)) {
    userIds = JSON.parse(fs.readFileSync(userIdFile));
    console.log('✅ Loaded cached user IDs.');
  }
} catch (err) {
  console.error('❌ Error loading local cache:', err.message);
}

// --- Get Twitter user ID from handle ---
async function getUserId(username) {
  try {
    const url = `https://api.twitter.com/2/users/by/username/${username}`;
    const res = await axios.get(url, { headers });
    return res.data.data.id;
  } catch (err) {
    console.error(`❌ Failed to get user ID for @${username}:`, err.response?.data || err.message);
    throw err;
  }
}

// --- Get latest tweet for a user ---
async function getLatestTweet(userId) {
  try {
    const url = `https://api.twitter.com/2/users/${userId}/tweets?max_results=5`;
    const res = await axios.get(url, { headers });
    return res.data.data?.[0]?.id;
  } catch (err) {
    console.error(`❌ Failed to get latest tweet for userId ${userId}:`, err.response?.data || err.message);
    throw err;
  }
}

// --- Fetch tweets newer than last seen ---
async function getNewTweets(userId, username) {
  try {
    const sinceId = lastSeen[username];
    let url = `https://api.twitter.com/2/users/${userId}/tweets?max_results=5&tweet.fields=created_at`;

    if (sinceId) url += `&since_id=${sinceId}`;

    const res = await axios.get(url, { headers });
    const tweets = res.data.data || [];

    // Filter out replies (only keep original tweets)
    const filteredTweets = tweets.filter(
        tweet => tweet.in_reply_to_user_id === null
    );
  
    if (filteredTweets.length > 0) {
        console.log(`📈 Found ${tweets.length} new tweet(s) for @${username}`);
        lastSeen[username] = filteredTweets[0].id;
    }

    return filteredTweets.reverse();
  } catch (err) {
    console.error(`❌ Error fetching tweets for @${username}:`, err.response?.data || err.message);
    return [];
  }
}

// --- Bootstrap on init ---
async function initializeLastSeen() {
  const newLastSeen = {};
  const newUserIds = {};

  console.log('🚀 Initializing user IDs and last seen tweet IDs...');
  for (const handle of userHandles) {
    try {
      const userId = await getUserId(handle);
      newUserIds[handle] = userId;

      await sleep(300); // Delay to prevent rate limit

      const latestTweetId = await getLatestTweet(userId);
      if (latestTweetId) {
        newLastSeen[handle] = latestTweetId;
        console.log(`✅ Bootstrapped @${handle} with tweet ID ${latestTweetId}`);
      } else {
        console.warn(`⚠️ No tweets found for @${handle}`);
      }
    } catch (err) {
      console.error(`❌ Skipped @${handle} due to an error.`);
    }
  }

  try {
    fs.writeFileSync(lastSeenFile, JSON.stringify(newLastSeen, null, 2));
    fs.writeFileSync(userIdFile, JSON.stringify(newUserIds, null, 2));
    console.log('📦 Saved userIds.json and lastSeen.json');
  } catch (err) {
    console.error('❌ Failed to save cache files:', err.message);
  }

  console.log('✅ Initialization complete.');
}

// --- Polling logic ---
async function poll() {
  console.log(`🕵️‍♂️ Polling for new tweets at ${new Date().toLocaleTimeString()}...`);

  for (const handle of userHandles) {
    const userId = userIds[handle];
    if (!userId) {
      console.warn(`⚠️ Skipping @${handle} — no userId found. Run with --init first.`);
      continue;
    }

    try {
      const newTweets = await getNewTweets(userId, handle);
      for (const tweet of newTweets) {
        console.log(`🔹 [@${handle}] ${tweet.text}`);
        // 🔧 Add GPT / response logic here
        const quote = await generateQuote(tweet.text);
        if (quote) {
            await postQuote(tweet.id, quote + " " + "@" + handle);
            console.log(handle, quote)
            await sleep(2); // avoid hitting rate limits
        }
      }
    } catch (err) {
      console.error(`❌ Error processing tweets for @${handle}:`, err.message);
    }
    sleep(60)
  }

  try {
    fs.writeFileSync(lastSeenFile, JSON.stringify(lastSeen, null, 2));
    console.log('💾 Updated lastSeen.json');
  } catch (err) {
    console.error('❌ Failed to save lastSeen.json:', err.message);
  }
}

// --- Start loop ---
async function startPolling() {
  console.log('🔁 Starting tweet polling loop...');
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

// --- Main ---
const isInitMode = process.argv.includes('--init');

if (isInitMode) {
  initializeLastSeen();
} else {
  startPolling();
}
