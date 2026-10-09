'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const wfDir=path.join(root,'.github','workflows');
const workflowFiles=fs.readdirSync(wfDir).filter(x=>/\.ya?ml$/i.test(x));

for(const name of workflowFiles){
  const text=fs.readFileSync(path.join(wfDir,name),'utf8');
  if(!/\bgit push\b/.test(text)) continue;
  assert(text.includes('group: market-data-writer'), name+' writes main but is not in shared market-data-writer concurrency group');
  assert(!/^\s*queue:/m.test(text), name+' contains unsupported concurrency queue key');
  assert(text.includes('git pull --rebase origin main'), name+' pushes main without rebasing first');
  if (/^\s{2}push:/m.test(text)) {
    assert(text.includes('ref: main'), name+' is a push-triggered writer but does not checkout latest main after concurrency wait');
    assert(text.includes('fetch-depth: 0'), name+' push-triggered writer must fetch main history for safe rebases');
  }
}

const reminders=fs.readFileSync(path.join(wfDir,'event-reminders.yml'),'utf8');
const refreshIdx=reminders.indexOf('Refresh durable current-week calendar slice');
const publishIdx=reminders.indexOf('Publish calendar changes before reminders');
const reminderIdx=reminders.indexOf('Check for events entering a reminder window');
assert(refreshIdx>=0,'event reminders must refresh current-week calendar');
assert(publishIdx>refreshIdx,'calendar heartbeat must publish after refresh');
assert(reminderIdx>publishIdx,'reminders must evaluate the published fresh calendar');
assert(reminders.includes('node refresh-calendar-snapshot.js'),'calendar heartbeat script missing from reminder workflow');
assert(reminders.includes('node build-data-manifest.js'),'manifest rebuild missing after heartbeat');
assert(reminders.includes('npm run test:calendar-heartbeat'),'heartbeat regression test missing from workflow');
assert(reminders.includes('continue-on-error: true'),'reminder delivery must fail open');
assert(reminders.includes('timeout-minutes: 2'),'reminder delivery must be time bounded');

const bbmaWatch=fs.readFileSync(path.join(wfDir,'bbma-watch.yml'),'utf8');
assert(bbmaWatch.includes('git status --porcelain -- data/bbma-watch.json'),'BBMA watcher must detect untracked/new snapshot files before deciding there is no change');
assert(!bbmaWatch.includes('git diff --quiet -- data/bbma-watch.json'),'BBMA watcher must not use git diff alone for a possibly untracked snapshot');

const learningHealth=fs.readFileSync(path.join(wfDir,'learning-health.yml'),'utf8');
assert(learningHealth.includes('Ensure BBMA watch snapshot exists'),'learning health must bootstrap a missing BBMA snapshot');
assert(learningHealth.includes('node build-bbma-watch.js'),'learning health bootstrap must rebuild the watch snapshot');
assert(learningHealth.includes('git add data/bbma-watch.json data/bbma-learning.json data/bbma-performance.json data/agent-health.json'),'learning health must persist a bootstrapped watch snapshot with its outputs');

const intelligence360=fs.readFileSync(path.join(wfDir,'intelligence-360.yml'),'utf8');
assert(intelligence360.includes('git status --porcelain -- data/intelligence-360.json'),'Intelligence 360 must detect untracked/new snapshot files');
assert(!intelligence360.includes('git diff --quiet -- data/intelligence-360.json'),'Intelligence 360 must not use git diff alone for a possibly untracked snapshot');
assert(intelligence360.includes('push:'),'Intelligence 360 must self-verify on relevant main changes');
assert(intelligence360.includes('node build-data-manifest.js'),'Intelligence 360 must rebuild the manifest after creating its lineage source');
assert(intelligence360.includes('git add data/intelligence-360.json data-manifest.json'),'Intelligence 360 must publish its snapshot and manifest atomically');

const workerDeploy=fs.readFileSync(path.join(wfDir,'deploy-worker.yml'),'utf8');
assert(!/^\s{2}push:/m.test(workerDeploy),'Worker deploy must remain manual until Cloudflare credentials are configured');
assert(workerDeploy.includes('workflow_dispatch: {}'),'Worker deploy must be manually runnable');
assert(workerDeploy.includes('exit 1'),'missing Cloudflare credentials must fail visibly');
assert(!workerDeploy.includes("if: steps.cf.outputs.ready == 'true'"),'Worker deploy must not silently skip deployment');
assert(workerDeploy.includes("/app.js"),'Worker deploy verification must check JavaScript routing');
assert(workerDeploy.includes("/data-manifest.json"),'Worker deploy verification must check JSON routing');

const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
assert(app.includes('function newsSyncSignature(a)'), 'client durable sync signature helper missing');
assert(app.includes('calendarGeneratedAt'), 'client must detect calendar-only snapshot changes');

const manifestBuild=fs.readFileSync(path.join(root,'build-data-manifest.js'),'utf8');
assert(manifestBuild.includes('calendarMaxMinutes:10'),'manifest must declare calendar freshness SLA');

console.log('workflow reliability tests passed');
