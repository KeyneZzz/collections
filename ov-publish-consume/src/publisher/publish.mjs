import { withFileLock } from "./lock.mjs";
import { verifyProjection } from "./projection.mjs";
import { createGitSnapshot } from "./snapshot.mjs";
import { projectionsEqual, readPublishedState, writePublishedState } from "./state.mjs";

export async function publishOnce(config, client, options = {}) {
  return withFileLock(config.lockFile, async () => {
    const logger = options.logger ?? console;
    const createSnapshot = options.createSnapshot ?? createGitSnapshot;
    const snapshot = await createSnapshot(config);
    logger.log(`Prepared revision ${snapshot.revision} with ${snapshot.files.length} Markdown files.`);
    if (options.dryRun) {
      logger.log("Dry run complete; no upstream request or state write was made.");
      return { snapshot, changed: false };
    }

    const previous = await readPublishedState(config.stateDir);
    if (previous?.revision === snapshot.revision && previous?.targetUri === config.targetUri) {
      try {
        const current = await verifyProjection(client, snapshot, config);
        if (projectionsEqual(current, previous.projection)) {
          logger.log("The pinned revision and live projection already match.");
          return { snapshot, changed: false, projection: current };
        }
        logger.log("The live projection drifted; publishing a complete snapshot.");
      } catch (error) {
        logger.log(`The live projection could not be verified; publishing a complete snapshot: ${message(error)}`);
      }
    }

    const submission = await client.addSnapshot({
      archive: snapshot.archive,
      sourceName: config.sourceName,
      targetUri: config.targetUri,
    });
    if (submission.rootUri !== config.targetUri) throw new Error(`Snapshot was submitted to unexpected root ${submission.rootUri}`);
    logger.log(`Submitted task ${submission.taskId}.`);
    await client.waitForTask(submission.taskId, config.targetUri);
    const projection = await verifyProjection(client, snapshot, config);
    await writePublishedState(config.stateDir, {
      version: 1,
      revision: snapshot.revision,
      targetUri: config.targetUri,
      taskId: submission.taskId,
      publishedAt: new Date().toISOString(),
      files: snapshot.files,
      projection,
    });
    logger.log(`Verified and recorded ${projection.reduce((count, item) => count + item.l2Uris.length, 0)} projected Markdown files.`);
    return { snapshot, changed: true, taskId: submission.taskId, projection };
  });
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
