const AWS = require( 'aws-sdk' );
AWS.config.update({ region:'us-east-1' });
const uuidv4 = require( 'uuid/v4' );
const axios = require( 'axios' );
const fs = require( 'fs' );
const leven = require( 'leven' );
const express = require( 'express' );
const bodyParser = require( 'body-parser' );
const app = express();
app.use( bodyParser.json());

/* Store the scores in memory */
const scores = {};

const ATS = new AWS.TranscribeService();

function startJob( url, sourceSentence ) {
  const jobID = uuidv4();
  scores[jobID] = { status: 'PROCESSING' };
  ATS.startTranscriptionJob({
    "TranscriptionJobName": jobID,
    "LanguageCode": "en-US",
    "MediaFormat": "m4a",
    "Media": {
      "MediaFileUri": url
    }
  }, (err,result) => {
    if(err) throw err;
    console.log(result);

    listenForResults( jobID, result => {
      axios.get( result ).then( success => {
        const data = JSON.stringify( success.data.results, null, 2 );
        console.log( data );
        const score = calculateScore( sourceSentence, success.data.results.transcripts );
        console.log( `Score for job ${jobID} is`, score );
        scores[jobID] = { status: 'COMPLETE', score };
      });
    });
  });

  return jobID;
}

function listenForResults( jobName, callback ) {
  ATS.getTranscriptionJob({
    "TranscriptionJobName": jobName,
  }, (err, result) => {
    if(err) throw err;
    console.log(result);

    if ( result.TranscriptionJob.TranscriptionJobStatus === 'COMPLETED' ) {
      callback( result.TranscriptionJob.Transcript.TranscriptFileUri );
    } else {
      setTimeout(() => {
        listenForResults( jobName, callback );
      }, 1000);
    }
  });
}

function calculateScore( sourceSentence, transcripts ) {
  const result = transcripts.map( t => t.transcript ).join( ' ' ).toLowerCase().split( ',' ).join( '' ).split( '.' ).join( '' );
  const source = sourceSentence.toLowerCase().split( ',' ).join( '' ).split( '.' ).join( '' );

  /* Calculate the distance between the two strings */
  const distance = leven( source, result );

  const maxLength = result.length > source.length ? result.length : source.length;

  /* Calculate the percentage difference */
  const difference = distance / maxLength;

  /* Turn this into a score out of 100 */
  const score = (( 1 - difference ) * 100).toFixed( 2 );

  return score;
}

app.post( '/score', ( req, res ) => {
  /* Get the request body */
  const { url, text } = req.body;

  /* Start the job */
  const jobID = startJob( url, text );

  /* Return the job ID */
  res.json({
    jobID,
  });
});

app.get( '/score/:id', ( req, res ) => {
  const { id } = req.params;
  if ( !scores[id] ) {
    res.status( 400 );
    res.json({ error: 'Job not found' });
    return;
  }

  res.json( scores[id] );
});

app.listen( 4545, () => {
  console.log( 'English scoring API listening on 4545' );
});

//startJob( "https://s3.amazonaws.com/eet-uploads-east/7.mp3", "You should check the mileage on your car since you've been driving it so much, and because it's starting to make weird noises." );
