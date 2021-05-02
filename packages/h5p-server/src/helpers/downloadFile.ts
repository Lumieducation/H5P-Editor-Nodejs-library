import axios, { AxiosError } from 'axios';
import fs from 'fs';

import * as stream from 'stream';
import { promisify } from 'util';
import H5pError from './H5pError';

const finished = promisify(stream.finished);

/**
 * Downloads a file to the local filesystem. Throws H5pError that contain the
 * HTTP status code of the outgoing request if something went wrong.
 * @param fileUrl
 * @param outputLocationPath
 * @returns
 */
export async function downloadFile(
    fileUrl: string,
    outputLocationPath: string
): Promise<any> {
    const writer = fs.createWriteStream(outputLocationPath);
    return axios({
        method: 'get',
        url: fileUrl,
        responseType: 'stream'
    })
        .then(async (response) => {
            response.data.pipe(writer);
            return finished(writer);
        })
        .catch((reason: AxiosError) => {
            if (reason.isAxiosError) {
                throw new H5pError(
                    'content-hub-download-error',
                    { message: reason.message },
                    Number.parseInt(reason.code, 10)
                );
            }
            throw new H5pError('content-hub-download-error');
        });
}
