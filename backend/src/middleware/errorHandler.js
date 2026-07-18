export const errorHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);

  // ApiError instances keep user-correctable failures machine-readable.
  const status = error.status || 500;
  res.status(status).json({
    error: {
      code: error.code || "internal_error",
      message: error.message || "Something went wrong.",
      details: error.details || {}
    }
  });
};
