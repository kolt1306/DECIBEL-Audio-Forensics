"""Bound request bytes before Starlette's multipart parser spools an upload."""
from starlette.responses import JSONResponse
from .config import MAX_UPLOAD_BYTES
from .errors import error_body


class UploadLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        paths = ('/api/analyze', '/api/v1/analyze', '/api/v1/compare', '/api/v1/jobs/analyze', '/api/v1/jobs/batch')
        if scope['type'] != 'http' or scope.get('path') not in paths:
            return await self.app(scope, receive, send)
        # Allow multipart headers in addition to the configured per-file cap.
        limit = MAX_UPLOAD_BYTES * (2 if scope.get('path') == '/api/v1/jobs/batch' else 1) + 65536
        headers = dict(scope.get('headers', []))
        try:
            oversized = int(headers.get(b'content-length', b'0')) > limit
        except ValueError:
            oversized = True
        if oversized:
            return await JSONResponse(error_body('REQUEST_TOO_LARGE', 'The upload request exceeds the configured limit.'), status_code=413)(scope, receive, send)
        total = 0
        async def bounded_receive():
            nonlocal total
            message = await receive()
            total += len(message.get('body', b''))
            if total > limit:
                # Starlette closes multipart temporary files for parser exceptions.
                from starlette.formparsers import MultiPartException
                raise MultiPartException('The upload request exceeds the configured limit.')
            return message
        async def bounded_send(message):
            if message['type'] == 'http.response.start' and total > limit:
                response = JSONResponse(error_body('REQUEST_TOO_LARGE', 'The upload request exceeds the configured limit.'), status_code=413)
                await response(scope, receive, send)
                return
            if total > limit:
                return
            await send(message)
        await self.app(scope, bounded_receive, bounded_send)
