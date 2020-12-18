const AWS = require('aws-sdk');
const express = require('express');
const ytdl = require('ytdl-core');

// Global vars
const apiStage = 'v1';
const transcoderFunctionName = 'DownTubeTranscoderFunction';
const s3Bucket = 'downtube-downloader';
const codec = 'audio/webm; codecs="opus"';

// AWS stuff
const lambda = new AWS.Lambda({ region: 'us-east-1'});
const s3 = new AWS.S3({ signatureVersion: 'v4' });

// Express stuff
const app = express();
const router = express.Router();

router.get('/transcode/:videoId', async (req, res) => {
  const timestamp = Date.now().toString();
  const { videoId } = req.params;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // Get the video info
    const info = await ytdl.getInfo(videoUrl);

    // Find the format to transcode to mp3
    const params = getTranscodeParams(info, timestamp);

    // Convert to mp3
    await callTranscodeLambda(params);
    res.status(200).send(JSON.stringify({ logKey: params.logKey, mp3Key: params.mp3Key }));
  } catch(error) {
    res.status(500).send(`Something went wrong: ${error.message}`);
  }
});

router.get('/signed-url/:mp3Key', (req, res) => {
  const mp3Key = decodeURIComponent(req.params.mp3Key);
  s3.getSignedUrl('getObject', {
    Bucket: s3Bucket,
    Expires: 3600,
    Key: mp3Key,
  }, (error, url) => {
    if (error) {
      res.status(500).send(`Mp3 not found: ${error.message}`);
    } else {
      res.status(200).send(JSON.stringify({ url }));
    }
  })
});

getTranscodeParams = (videoInfo, timestamp) => {
  const title = videoInfo.videoDetails.title;
  const format = videoInfo.formats
    .filter(format => format.mimeType == codec)[0];

  return {
    filename: `${title}.mp3`,
    logKey: `log/${timestamp} - ${title}.log`,
    mp3Key: `mp3/${timestamp} - ${title}.mp3`,
    s3Bucket,
    url: format.url,
  };
}

callTranscodeLambda = (params) => {
  return new Promise((resolve, revoke) => {
    lambda.invoke({
      FunctionName: transcoderFunctionName,
      InvocationType: 'Event',
      Payload: JSON.stringify(params),
    }, error => error ? revoke(error) : resolve(params));
  });
}

if (!module.parent) {
  app.use(`/${apiStage}/`, router);
  app.listen(3000, () => console.log('Listening on port 3000!'));
} else {
  app.use('/', router);
}

module.exports = app;