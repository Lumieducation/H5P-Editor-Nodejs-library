// Classes
import H5PEditor from './H5PEditor';
import H5PPlayer from './H5PPlayer';
import H5pError from './helpers/H5pError';
import InstalledLibrary from './InstalledLibrary';
import LibraryName from './LibraryName';
import PackageExporter from './PackageExporter';

import H5PConfig from './implementation/H5PConfig';
import fs from './implementation/fs';
import DirectoryTemporaryFileStorage from './implementation/fs/DirectoryTemporaryFileStorage';
import FileContentStorage from './implementation/fs/FileContentStorage';
import FileLibraryStorage from './implementation/fs/FileLibraryStorage';
import JsonStorage from './implementation/fs/JsonStorage';
import InMemoryStorage from './implementation/InMemoryStorage';

// Interfaces
import {
    ContentId,
    ContentParameters,
    IContentMetadata,
    IContentStorage,
    IH5PConfig,
    IInstalledLibrary,
    IKeyValueStorage,
    ILibraryFileUrlResolver,
    ILibraryMetadata,
    ILibraryName,
    ILibraryStorage,
    IPlayerModel,
    ITemporaryFile,
    ITemporaryFileStorage,
    ITranslationFunction,
    IUser,
    IRequestWithUser,
    IRequestWithLanguage,
    IRequestWithTranslator,
    Permission,
    ILibraryAdministrationOverviewItem,
    IFileStats
} from './types';

// Adapters
import express from './adapters/H5PAjaxRouter/H5PAjaxExpressRouter';
import { errorHandler } from './adapters/expressErrorHandler';
import expressController from './adapters/H5PAjaxRouter/H5PAjaxExpressController';
import LibraryAdministrationExpressRouter from './adapters/LibraryAdministrationRouter/LibraryAdministrationExpressRouter';
import ContentTypeCacheExpressRouter from './adapters/ContentTypeCacheRouter/ContentTypeCacheExpressRouter';

const adapters = {
    express,
    expressController,
    expressErrorHandler: errorHandler,
    LibraryAdministrationExpressRouter,
    ContentTypeCacheExpressRouter
};

const fsImplementations = {
    DirectoryTemporaryFileStorage,
    FileContentStorage,
    FileLibraryStorage,
    InMemoryStorage,
    JsonStorage
};

export {
    // classes
    H5PEditor,
    H5pError,
    H5PPlayer,
    InstalledLibrary,
    LibraryName,
    PackageExporter,
    // interfaces
    ContentId,
    ContentParameters,
    IContentMetadata,
    IContentStorage,
    IH5PConfig,
    IInstalledLibrary,
    IKeyValueStorage,
    ILibraryFileUrlResolver,
    ILibraryMetadata,
    ILibraryName,
    ILibraryStorage,
    ILibraryAdministrationOverviewItem,
    IPlayerModel,
    ITemporaryFile,
    ITemporaryFileStorage,
    ITranslationFunction,
    IUser,
    IRequestWithUser,
    IRequestWithLanguage,
    IRequestWithTranslator,
    Permission,
    IFileStats,
    // implementations
    H5PConfig,
    fs,
    fsImplementations,
    // adapters
    adapters
};
