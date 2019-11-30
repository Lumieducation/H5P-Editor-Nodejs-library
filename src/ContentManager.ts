import { ReadStream } from 'fs';
import fsExtra from 'fs-extra';
import globPromise from 'glob-promise';
import * as path from 'path';
import { Stream } from 'stream';

import H5pError from './helpers/H5pError';
import { streamToString } from './helpers/StreamHelpers';
import {
    ContentId,
    ContentParameters,
    IContentMetadata,
    IContentStorage,
    IUser,
    Permission
} from './types';

import Logger from './helpers/Logger';

const log = new Logger('ContentManager');

/**
 * The ContentManager takes care of saving content and dependent files. It only contains storage-agnostic functionality and
 * depends on a ContentStorage object to do the actual persistence.
 */
export default class ContentManager {
    /**
     * @param {FileContentStorage} contentStorage The storage object
     */
    constructor(contentStorage: IContentStorage) {
        log.info('initialize');
        this.contentStorage = contentStorage;
    }

    private contentStorage: IContentStorage;

    /**
     * Adds a content file to an existing content object. The content object has to be created with createContent(...) first.
     * @param {number} contentId The id of the content to add the file to
     * @param {string} filename The name of the content file
     * @param {Stream} stream A readable stream that contains the data
     * @param {IUser} user The user who owns this object
     * @returns {Promise<void>}
     */
    public async addContentFile(
        contentId: ContentId,
        filename: string,
        stream: Stream,
        user: IUser
    ): Promise<void> {
        log.info(`adding file ${filename} to content ${contentId}`);
        return this.contentStorage.addContentFile(
            contentId,
            filename,
            stream,
            user
        );
    }

    /**
     * Checks if a piece of content exists.
     * @param contentId the content to check
     * @returns true if the piece of content exists
     */
    public async contentExists(contentId: ContentId): Promise<boolean> {
        log.debug(`checking if content ${contentId} exists`);
        return this.contentStorage.contentExists(contentId);
    }

    /**
     * Checks if a file exists.
     * @param contentId The id of the content to add the file to
     * @param filename the filename of the file to get
     * @returns true if the file exists
     */
    public async contentFileExists(
        contentId: ContentId,
        filename: string
    ): Promise<boolean> {
        return this.contentStorage.contentFileExists(contentId, filename);
    }

    /**
     * Adds content from a H5P package (in a temporary directory) to the installation.
     * It does not check whether the user has permissions to save content.
     * @param packageDirectory The absolute path containing the package (the directory containing h5p.json)
     * @param user The user who is adding the package.
     * @param contentId (optional) The content id to use for the package
     * @returns The id of the content that was created (the one passed to the method or a new id if there was none).
     */
    public async copyContentFromDirectory(
        packageDirectory: string,
        user: IUser,
        contentId?: ContentId
    ): Promise<{ id: ContentId; metadata: IContentMetadata; parameters: any }> {
        log.info(`copying content from directory ${packageDirectory}`);
        const metadata: IContentMetadata = await fsExtra.readJSON(
            path.join(packageDirectory, 'h5p.json')
        );
        const parameters: ContentParameters = await fsExtra.readJSON(
            path.join(packageDirectory, 'content', 'content.json')
        );
        const otherContentFiles: string[] = (
            await globPromise(path.join(packageDirectory, 'content', '**/*.*'))
        ).filter(
            (file: string) =>
                path.relative(packageDirectory, file) !== 'content.json'
        );

        const newContentId: ContentId = await this.contentStorage.createContent(
            metadata,
            parameters,
            user,
            contentId
        );
        try {
            await Promise.all(
                otherContentFiles.map((file: string) => {
                    const readStream: Stream = fsExtra.createReadStream(file);
                    const localPath: string = path.relative(
                        path.join(packageDirectory, 'content'),
                        file
                    );
                    log.debug(`adding ${file} to ${packageDirectory}`);
                    return this.contentStorage.addContentFile(
                        newContentId,
                        localPath,
                        readStream
                    );
                })
            );
        } catch (error) {
            log.error(error);
            await this.contentStorage.deleteContent(newContentId);
            throw error;
        }
        return { id: newContentId, metadata, parameters };
    }

    /**
     * Creates a content object in the repository. Add files to it later with addContentFile(...).
     * @param metadata The metadata of the content (= h5p.json)
     * @param content the content object (= content/content.json)
     * @param user The user who owns this object.
     * @param contentId (optional) The content id to use
     * @returns The newly assigned content id
     */
    public async createOrUpdateContent(
        metadata: IContentMetadata,
        content: ContentParameters,
        user: IUser,
        contentId?: ContentId
    ): Promise<ContentId> {
        log.info(`creating content for ${contentId}`);
        return this.contentStorage.createContent(
            metadata,
            content,
            user,
            contentId
        );
    }

    /**
     * Deletes a piece of content and all files dependent on it.
     * @param contentId the piece of content to delete
     * @param user the user who wants to delete it
     */
    public async deleteContent(
        contentId: ContentId,
        user: IUser
    ): Promise<void> {
        return this.contentStorage.deleteContent(contentId, user);
    }

    /**
     * Deletes a file from a content object.
     * @param contentId the content object the file is attached to
     * @param filename the file to delete
     */
    public async deleteContentFile(
        contentId: ContentId,
        filename: string
    ): Promise<void> {
        return this.contentStorage.deleteContentFile(contentId, filename);
    }

    /**
     * Gets the filenames of files added to the content with addContentFile(...) (e.g. images, videos or other files)
     * @param contentId the piece of content
     * @param user the user who wants to access the piece of content
     * @returns a list of files that are used in the piece of content, e.g. ['image1.png', 'video2.mp4']
     */
    public async getContentFiles(
        contentId: ContentId,
        user: IUser
    ): Promise<string[]> {
        log.info(`loading content files for ${contentId}`);
        return this.contentStorage.getContentFiles(contentId, user);
    }

    /**
     * Returns a readable stream of a content file (e.g. image or video) inside a piece of content
     * @param {number} contentId the id of the content object that the file is attached to
     * @param {string} filename the filename of the file to get
     * @param {IUser} user the user who wants to retrieve the content file
     * @returns {Stream}
     */
    public async getContentFileStream(
        contentId: ContentId,
        filename: string,
        user: IUser
    ): Promise<ReadStream> {
        log.debug(`loading ${filename} for ${contentId}`);
        if (
            !(await this.contentStorage.contentFileExists(contentId, filename))
        ) {
            throw new H5pError(
                `File ${filename} does not exist in ${contentId}`
            );
        }
        return this.contentStorage.getContentFileStream(
            contentId,
            filename,
            user
        );
    }

    /**
     * Returns an array of permissions a user has on a piece of content.
     * @param contentId the content to check
     * @param user the user who wants to access the piece of content
     * @returns an array of permissions
     */
    public async getUserPermissions(
        contentId: ContentId,
        user: IUser
    ): Promise<Permission[]> {
        log.info(`checking user permissions for ${contentId}`);
        return this.contentStorage.getUserPermissions(contentId, user);
    }

    /**
     * Returns the content object (=contents of content/content.json) of a piece of content.
     * @param {number} contentId the content id
     * @param {IUser} user The user who wants to access the content
     * @returns {Promise<any>}
     */
    public async loadContent(
        contentId: ContentId,
        user: IUser
    ): Promise<ContentParameters> {
        return this.getFileJson(contentId, 'content.json', user);
    }

    /**
     * Returns the metadata (=contents of h5p.json) of a piece of content.
     * @param {number} contentId the content id
     * @param {IUser} user The user who wants to access the content
     * @returns {Promise<any>}
     */
    public async loadH5PJson(
        contentId: ContentId,
        user: IUser
    ): Promise<IContentMetadata> {
        return this.getFileJson(contentId, 'h5p.json', user);
    }

    /**
     * Returns the decoded JSON data inside a file
     * @param {number} contentId The id of the content object that the file is attached to
     * @param {string} file The filename to get
     * @param {IUser} user The user who wants to access this object
     * @returns {Promise<any>}
     */
    private async getFileJson(
        contentId: ContentId,
        file: string,
        user: IUser
    ): Promise<any> {
        log.debug(`loading ${file} for ${contentId}`);
        const stream: Stream = this.contentStorage.getContentFileStream(
            contentId,
            file,
            user
        );
        const jsonString: string = await streamToString(stream);
        return JSON.parse(jsonString);
    }
}
