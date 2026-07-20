export const errorHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);

  // ApiError instances keep user-correctable failures machine-readable.
  const isMalformedJson = error instanceof SyntaxError && error.status === 400 && "body" in error;
  const isMalformedId = error.name === "CastError";
  const status = isMalformedJson || isMalformedId ? 400 : error.status || 500;
  const code = isMalformedJson
    ? "malformed_json"
    : isMalformedId
      ? "malformed_id"
      : error.code || "internal_error";
  const message = isMalformedJson
    ? "Request body must be valid JSON."
    : isMalformedId
      ? "Request contains an invalid id."
      : error.message || "Something went wrong.";

  res.status(status).json({
    error: {
      code,
      message,
      details: error.details || {}
    }
  });
};
