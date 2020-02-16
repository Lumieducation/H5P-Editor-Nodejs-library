import AggregateH5pError from '../helpers/AggregateH5pError';
import H5pError from '../helpers/H5pError';

export default function errorHandlerFactory(): (
    err: Error,
    req: any,
    res: any,
    next: any
) => any {
    return (err, req, res, next) => {
        let statusCode = 500;
        let statusText = '';

        if (err instanceof H5pError) {
            statusCode = err.httpStatusCode;
            statusText = req.t(
                err.errorId,
                res.language || 'en',
                err.replacements
            );
        } else if (err instanceof AggregateH5pError) {
            statusCode = 400;
            statusText = err
                .getErrors()
                .map(e =>
                    req.t(e.errorId, res.language || 'en', e.replacements)
                )
                .join('\n');
        } else {
            statusText = err.message;
        }
        res.status(statusCode).end(statusText);
    };
}
