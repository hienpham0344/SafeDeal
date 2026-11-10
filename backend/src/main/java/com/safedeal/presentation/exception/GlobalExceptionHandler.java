package com.safedeal.presentation.exception;

import com.safedeal.presentation.dto.ApiErrorPayload;
import com.safedeal.shared.exception.DomainException;
import com.safedeal.shared.validation.CorrelationIdContext;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ApiErrorPayload> handleDomainException(DomainException ex) {
        return ResponseEntity.status(ex.getHttpStatus()).body(new ApiErrorPayload(
            ex.getErrorCode(),
            ex.getMessage(),
            CorrelationIdContext.getOrDefault("n/a"),
            Instant.now(),
            null
        ));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorPayload> handleValidationErrors(MethodArgumentNotValidException ex) {
        List<ApiErrorPayload.ApiFieldError> fieldErrors = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> new ApiErrorPayload.ApiFieldError(fe.getField(), fe.getDefaultMessage()))
            .toList();
        return ResponseEntity.badRequest().body(new ApiErrorPayload(
            "REQUEST_VALIDATION_FAILED",
            "Submitted request contains invalid fields.",
            CorrelationIdContext.getOrDefault("n/a"),
            Instant.now(),
            fieldErrors
        ));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiErrorPayload> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        return ResponseEntity.badRequest().body(new ApiErrorPayload(
            "INVALID_PARAMETER",
            "Invalid value for parameter '" + ex.getName() + "'.",
            CorrelationIdContext.getOrDefault("n/a"),
            Instant.now(),
            null
        ));
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, MissingServletRequestPartException.class})
    public ResponseEntity<ApiErrorPayload> handleMissingRequestPartOrParam(Exception ex) {
        String name = ex instanceof MissingServletRequestParameterException paramEx
            ? paramEx.getParameterName()
            : ((MissingServletRequestPartException) ex).getRequestPartName();
        return ResponseEntity.badRequest().body(new ApiErrorPayload(
            "MISSING_PARAMETER",
            "Required request parameter or part '" + name + "' is missing.",
            CorrelationIdContext.getOrDefault("n/a"),
            Instant.now(),
            null
        ));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorPayload> handleMalformedJson(HttpMessageNotReadableException ex) {
        return ResponseEntity.badRequest().body(new ApiErrorPayload(
            "MALFORMED_JSON",
            "Request body could not be parsed as valid JSON.",
            CorrelationIdContext.getOrDefault("n/a"),
            Instant.now(),
            null
        ));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiErrorPayload> handleOversizedUpload(MaxUploadSizeExceededException ex) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(new ApiErrorPayload(
            "FILE_TOO_LARGE",
            "Uploaded evidence attachment exceeds maximum allowed size.",
            CorrelationIdContext.getOrDefault("n/a"),
            Instant.now(),
            null
        ));
    }

    @ExceptionHandler(MultipartException.class)
    public ResponseEntity<ApiErrorPayload> handleInvalidMultipart(MultipartException ex) {
        return ResponseEntity.badRequest().body(new ApiErrorPayload(
            "INVALID_MULTIPART_REQUEST",
            "Malformed multipart upload request.",
            CorrelationIdContext.getOrDefault("n/a"),
            Instant.now(),
            null
        ));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiErrorPayload> handleMethodNotSupported(HttpRequestMethodNotSupportedException ex) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(new ApiErrorPayload(
            "METHOD_NOT_ALLOWED",
            "HTTP method '" + ex.getMethod() + "' is not supported for this endpoint.",
            CorrelationIdContext.getOrDefault("n/a"),
            Instant.now(),
            null
        ));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiErrorPayload> handleConstraintConflict(DataIntegrityViolationException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiErrorPayload(
            "DATA_CONFLICT",
            "Submitted operation conflicts with an existing record.",
            CorrelationIdContext.getOrDefault("n/a"),
            Instant.now(),
            null
        ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorPayload> handleUnexpected(Exception ex, HttpServletRequest req) {
        String correlationId = CorrelationIdContext.getOrDefault("n/a");
        log.error("Unhandled API exception on {} {} [correlationId={}]", req.getMethod(), req.getRequestURI(), correlationId, ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(new ApiErrorPayload(
            "INTERNAL_ERROR",
            "An unexpected internal error occurred. Reference correlationId: " + correlationId,
            correlationId,
            Instant.now(),
            null
        ));
    }
}
