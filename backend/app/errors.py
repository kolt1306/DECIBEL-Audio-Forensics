from fastapi import Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


class AnalysisError(Exception):
    def __init__(self, code, message, status=422):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def error_body(code, message):
    return {'error': {'code': code, 'message': message}}


async def analysis_error_handler(request: Request, exc: AnalysisError):
    return JSONResponse(error_body(exc.code, exc.message), status_code=exc.status)


async def validation_error_handler(request: Request, exc: RequestValidationError):
    missing_audio = any('audio' in item['loc'] or 'files' in item['loc'] for item in exc.errors())
    return JSONResponse(error_body('NO_AUDIO' if missing_audio else 'INVALID_REQUEST',
        'Choose an audio file.' if missing_audio else 'The request fields are invalid.'), status_code=422)


async def http_error_handler(request: Request, exc: HTTPException):
    code = 'INVALID_REQUEST' if exc.status_code == 400 else 'NOT_FOUND' if exc.status_code == 404 else 'HTTP_ERROR'
    return JSONResponse(error_body(code, 'The request could not be processed.'), status_code=exc.status_code)


async def unexpected_error_handler(request: Request, exc: Exception):
    return JSONResponse(error_body('INFERENCE_FAILED', 'The server could not complete this request.'), status_code=500)
