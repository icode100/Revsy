"""The same leased processor runs locally or within a Cloud Tasks HTTP request."""

import logging
from quiz_parser.domain import InvalidImport, LeaseLost
from quiz_parser.worker import Heartbeat, Worker
from .pipeline import parse_gemini_job

logger = logging.getLogger("quiz_gemini")


class GeminiWorker(Worker):
    def process(self, job):
        heartbeat = Heartbeat(self.store, job)
        heartbeat.start()
        try:
            with self.models.processing_budget():
                draft = parse_gemini_job(self.store, self.models, job)
            heartbeat.stop()
            if heartbeat.lost:
                raise LeaseLost("The parsing lease stopped.")
            self.store.owned_update(job, {"status": "ready", "message": "Full paper ready to review and save.",
                "draft": draft}, terminal=True)
        except LeaseLost:
            logger.info("Import stopped after its lease changed")
        except Exception as error:
            heartbeat.stop()
            message = str(error) if isinstance(error, InvalidImport) else "Google parsing could not finish. Check the server configuration and start a new import."
            try:
                self.store.owned_update(job, {"status": "failed", "message": message, "error": message}, terminal=True)
            except Exception:
                logger.error("Could not persist import failure; the durable lease will recover")
            logger.warning("Import failed (%s)", type(error).__name__)
        finally:
            heartbeat.stop()
