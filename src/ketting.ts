import * as LinkHeader from 'http-link-header';
import Follower from './follower';
import { LinkSet } from './link';
import Representor from './representor/base';
import HalRepresentor from './representor/hal';
import HtmlRepresentor from './representor/html';
import JsonApiRepresentor from './representor/jsonapi';
import SirenRepresentor from './representor/siren';
import Resource from './resource';
import { ContentType, KettingInit, LinkVariables } from './types';
import FetchHelper from './utils/fetch-helper';
import './utils/fetch-polyfill';
import { isSafeMethod } from './utils/http';
import { resolve } from './utils/url';

/**
 * The main Ketting client object.
 */
export default class Ketting {

  /**
   * The url from which all discovery starts.
   */
  bookMark: string;

  /**
   * Here we store all the resources that were ever requested. This will
   * ensure that if the same resource is requested twice, the same object is
   * returned.
   */
  resourceCache: { [url: string]: Resource };

  /**
   * Content-Type settings and mappings.
   *
   * See the constructor for an example of the structure.
   */
  contentTypes: ContentType[];

  /**
   * The helper class that calls fetch() for us
   */
  private fetchHelper: FetchHelper;

  constructor(bookMark: string, options?: Partial<KettingInit>) {

    if (typeof options === 'undefined') {
      options = {};
    }

    this.resourceCache = {};

    this.contentTypes = [
      {
        mime: 'application/hal+json',
        representor: 'hal',
        q: '1.0',
      },
      {
        mime: 'application/vnd.api+json',
        representor: 'jsonapi',
        q: '0.9',
      },
      {
        mime: 'application/vnd.siren+json',
        representor: 'siren',
        q: '0.9',
      },
      {
        mime: 'application/json',
        representor: 'hal',
        q: '0.8',
      },
      {
        mime: 'text/html',
        representor: 'html',
        q: '0.7',
      }
    ];

    this.bookMark = bookMark;
    this.fetchHelper = new FetchHelper(options, this.beforeRequest.bind(this), this.afterRequest.bind(this));

  }

  /**
   * This function is a shortcut for getResource().follow(x);
   */
  follow<TResource = any>(rel: string, variables?: LinkVariables): Follower<TResource> {

    return this.getResource().follow(rel, variables);

  }

  /**
   * Returns a resource by its uri.
   *
   * This function doesn't do any HTTP requests. The uri is optional. If it's
   * not specified, it will return the bookmark resource.
   *
   * If a relative uri is passed, it will be resolved based on the bookmark
   * uri.
   */
  go<TResource = any>(uri?: string): Resource<TResource> {

    if (typeof uri === 'undefined') {
      uri = '';
    }
    uri = resolve(this.bookMark, uri);

    if (!this.resourceCache[uri]) {
      this.resourceCache[uri] = new Resource(this, uri);
    }

    return this.resourceCache[uri];

  }

  /**
   * Returns a resource by its uri.
   *
   * This function doesn't do any HTTP requests. The uri is optional. If it's
   * not specified, it will return the bookmark resource.
   */
  getResource(uri?: string): Resource {

    return this.go(uri);

  }

  /**
   * This function does an arbitrary request using the fetch API.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/GlobalFetch}
   */
  fetch(input: string|Request, init?: RequestInit): Promise<Response> {

    return this.fetchHelper.fetch(
      input,
      init
    );

  }

  createRepresentation(uri: string, contentType: string, body: string | null, headerLinks: LinkSet): Representor<any> {

    if (contentType.indexOf(';') !== -1) {
      contentType = contentType.split(';')[0];
    }
    contentType = contentType.trim();
    const result = this.contentTypes.find(item => {
      return item.mime === contentType;
    });

    if (!result) {
      throw new Error('Could not find a representor for contentType: ' + contentType);
    }

    switch (result.representor) {
      case 'html' :
        return new HtmlRepresentor(uri, contentType, body, headerLinks);
    case 'hal' :
        return new HalRepresentor(uri, contentType, body, headerLinks);
    case 'jsonapi' :
        return new JsonApiRepresentor(uri, contentType, body, headerLinks);
    case 'siren' :
        return new SirenRepresentor(uri, contentType, body, headerLinks);
    default :
      throw new Error('Unknown representor: ' + result.representor);

    }

  }

  /**
   * Generates an accept header string, based on registered Resource Types.
   */
  getAcceptHeader(): string {

    return this.contentTypes
      .map( contentType => {
        let item = contentType.mime;
        if (contentType.q) { item += ';q=' + contentType.q; }
        return item;
      } )
      .join(', ');

  }

  beforeRequest(request: Request): void {

    if (isSafeMethod(request.method)) { return; }

    if (request.url in this.resourceCache) {
      // Clear cache
      this.resourceCache[request.url].clearCache();
    }
  }

  afterRequest(request: Request, response: Response): void {

    if (isSafeMethod(request.method)) { return; }
    if (response.headers.has('Link')) {
      for (const httpLink of LinkHeader.parse(response.headers.get('Link')!).rel('invalidates')) {
        const uri = resolve(request.url, httpLink.uri);
        if (uri in this.resourceCache) {
          this.resourceCache[uri].clearCache();
        }
      }
    }

  }

}
