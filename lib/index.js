#!/usr/bin/env node

const yargs = require('yargs');
const path = require('path');
const Parser = require('rss-parser');
const chunk = require('lodash').chunk;
const Axios = require('axios');
const fs = require('fs');

const MAX_CONCURRENT = 4;

const argv = yargs
      .usage('Usage: $0 <rssfeed> --dest <folder>')
      .option('d', {
        description: 'directory to download podcast to',
        default: path.resolve('.'),
        alias: 'destination',
      })
      .option('last', {
        description: 'n most recent episodes to download',
        requiresArg: true,
        type: 'number',
      })
      .alias('h', 'help')
      .help()
      .demand(1, 'Please specify an RSS feed')
      .argv;


if (argv._.length > 1) {
  throw new Error(`Expected only one argument but received ${argv._}`);
}

let destination;

if (argv.destination == undefined) {
  destination = path.resolve('.');
} else {
  destination = argv.destination;
}

let rssfeed = argv._[0];

function canonicalizeTitle(title) {
  title = title.replace(/ /g, '-');
  title = title.replace(/[^A-Z0-9_-]/ig, '');
  return title;
}

function parseEpisode(item) {
  let url = item.enclosure.url;
  let fileType = url.slice(url.lastIndexOf('.'));
  let filename = canonicalizeTitle(item.title) + fileType;
  return {filename: filename, url: url}
}

class EpisodeError extends Error {
  constructor(episode, err) {
    super();
    this.filename = episode.filename;
    this.url = episode.url
    this.fullError = err;
  }

  toString() {
    return `Failed to download ${this.url} to ${this.filename}\nSource Error: ${this.fullError.toString()}\n${this.fullError.stack}`;
  }
}

async function downloadEpisode(episode, destination) {
  let filename = path.join(destination, episode.filename);
  let response = await Axios({
    method: 'GET',
    url: episode.url,
    responseType: 'stream'
  });

  response.data.pipe(fs.createWriteStream(filename));

  return new Promise((resolve, reject) => {
    response.data.on('end', () => {
      console.log(`downloaded to ${filename}`);
      resolve('success');
    });
    response.data.on('error', (err) => {
      resolve(new EpisodeError(episode, err));
    });
  });
}

async function downloadChunk(chunk, destination) {
  let resultMap = {success: 0, failed: []};
  let results = await Promise.all(
    chunk.map((e) => downloadEpisode(e, destination))
  );
  
  for (let r of results) {
    if (r instanceof EpisodeError) {
      resultMap.failed.push(r);
    } else {
      resultMap.success++;
    }
  }
  return resultMap;
}

async function processRssFeed(url, destination) {
  let parser = new Parser();
  let feed = await parser.parseURL(url);
  let title = canonicalizeTitle(feed.title);
  let episodes = feed.items.filter(i => i.enclosure.type.startsWith('audio')).map(parseEpisode);

  // sort the episodes by date
  episodes.sort((a, b) => Date.parse(a.isoDate) - Date.parse(b.isoDate))
  
  let chunks = chunk(episodes, MAX_CONCURRENT);
  let results = {success: 0, failed: []}
  for (let chunk of chunks) {
    let chunkResults = await downloadChunk(chunk, destination);
    results.success += chunkResults.success;
    results.failed.concat(chunkResults.failed);
    console.log('Sleeping for 5s before processing more episodes');
    await setTimeout(() => Promise.resolve(true), 5000);
  }
  console.log(`Successfully downloaded ${results.success}`);
  if (results.failed.length > 0) {
    console.log(`Failed to download ${results.failed.join(', ')}`);
    for (let failure in results.failed) {
      console.error(failure.toString());
    }
  }
}

processRssFeed(rssfeed, destination);




