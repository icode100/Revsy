"""Persistent polling and renewable leases survive container/request restarts."""

import logging
import threading

from .domain import InvalidImport, LeaseLost
from .pipeline import parse_job

logger = logging.getLogger("quiz_parser")


class Heartbeat:
    def __init__(self, store, job):
        self.store, self.job = store, job
        self.stop_event = threading.Event()
        self.lost = False
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while not self.stop_event.wait(min(30, self.store.settings.lease_seconds / 3)):
            try:
                self.store.owned_update(self.job, {})
            except Exception:
                self.lost = True
                return

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=5)


class Worker:
    def __init__(self, store, models):
        self.store, self.models = store, models
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True, name="quiz-import-worker")

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        # The durable lease, not a shutdown callback, recovers interrupted inference.
        self.thread.join(timeout=5)

    def process(self, job):
        heartbeat = Heartbeat(self.store, job)
        heartbeat.start()
        try:
            draft = parse_job(self.store, self.models, job)
            heartbeat.stop()
            if heartbeat.lost:
                raise LeaseLost("The lease heartbeat stopped.")
            self.store.owned_update(job, {"status": "ready", "message": "Ready to review and save.", "draft": draft}, terminal=True)
        except LeaseLost:
            logger.info("Import %s stopped after losing its lease", job["id"])
        except Exception as exc:
            heartbeat.stop()
            message = str(exc) if isinstance(exc, InvalidImport) else "Parsing could not finish. Check the service configuration and upload a new import."
            try:
                self.store.owned_update(job, {"status": "failed", "message": message, "error": message}, terminal=True)
            except LeaseLost:
                pass
            except Exception:
                logger.error("Could not persist failure for import %s; its lease will recover", job["id"])
            logger.warning("Import %s failed (%s)", job["id"], type(exc).__name__)
        finally:
            heartbeat.stop()

    def run(self):
        while not self.stop_event.is_set():
            try:
                for reference in self.store.candidates():
                    if self.stop_event.is_set():
                        return
                    try:
                        job = self.store.claim(reference)
                    except InvalidImport:
                        logger.warning("Skipped malformed import document")
                        continue
                    if job is not None:
                        self.process(job)
            except Exception as exc:
                # Do not log exception bodies: upstream exceptions may contain signed URLs.
                logger.error("Queue poll failed (%s); check Firestore indexes and permissions", type(exc).__name__)
            self.stop_event.wait(self.store.settings.poll_seconds)
