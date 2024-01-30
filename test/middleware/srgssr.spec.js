import SrgSsr from '../../src/middleware/srgssr.js';
import DataProvider from '../../src/dataProvider/services/DataProvider.js';
import Image from '../../src/utils/Image.js';
import MediaComposition from '../../src/dataProvider/model/MediaComposition.js';
import urnCredits from '../__mocks__/urn:rts:video:10313496-credits.json';
import urnRtsAudio from '../__mocks__/urn:rts:audio:3262320.json';
import Pillarbox from '../../src/pillarbox.js';
import AkamaiTokenService from '../../src/utils/AkamaiTokenService.js';

jest.mock('../../src/dataProvider/services/DataProvider.js');
jest.mock('../../src/utils/Image.js');
jest.mock('../../src/pillarbox.js');

window.MediaError = jest.fn().mockRejectedValue({ MEDIA_ERR_ABORTED: 1 });

describe('SrgSsr', () => {
  let player;

  beforeAll(() => {
    DataProvider.mockImplementation(() => {
      return {
        getMediaCompositionByUrn: (urn, _onlyChapters = false) => {
          if (!urn) throw new Error('Error');

          return Promise.resolve({
            mediaComposition: Object.assign(new MediaComposition(), urnCredits),
          });
        },
      };
    });
    AkamaiTokenService.tokenize = jest.fn((source) => Promise.resolve(source));

    Image.scale = jest.fn(({ url }) => `https://mock-scale.ch/${url}`);

    player = {
      debug: jest.fn(),
      error: jest.fn(),
      localize: jest.fn(),
      on: jest.fn(),
      one: jest.fn(),
      options: jest.fn().mockReturnValue({ srgOptions: {}, trackers: {}}),
      poster: (url) => url,
      src: jest.fn(),
      titleBar: {
        update: ({ title, description }) => ({ title, description }),
      },
    };
  });

  /**
   *****************************************************************************
   * blockingReason ************************************************************
   *****************************************************************************
   */
  describe('blockingReason', () => {
    it('should return undefined if the block reason is undefined', async () => {
      const spyOnLocalize = jest.spyOn(player, 'localize');

      expect(SrgSsr.blockingReason(player, undefined, {})).toBeUndefined();
      expect(spyOnLocalize).not.toHaveBeenCalled();
    });

    it('should return true and generate an error', async () => {
      const spyOnLocalize = jest.spyOn(player, 'localize');
      const spyOnPlayerError = jest.spyOn(player, 'error');
      const spyOnError = jest.spyOn(SrgSsr, 'error');

      expect(SrgSsr.blockingReason(player, 'STARTDATE', {})).toBe(true);
      expect(spyOnLocalize).toHaveBeenCalled();
      expect(spyOnError).toHaveBeenCalledWith(player, expect.any(Object));
      expect(spyOnPlayerError.mock.calls[1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ metadata: { errorType: 'STARTDATE', src: {}}})
        ])
      );
    });
  });

  /**
   *****************************************************************************
   * composeAkamaiResources ****************************************************
   *****************************************************************************
   */
  describe('composeAkamaiResources', () => {
    it('should return an empty array if the resources are not defined or if the array is empty', async () => {
      expect(await SrgSsr.composeAkamaiResources()).toHaveLength(0);
      expect(await SrgSsr.composeAkamaiResources([])).toHaveLength(0);
    });

    it('should not tokenize a resource', () => {
      const spyOnTokenizeSources = jest.spyOn(AkamaiTokenService, 'tokenizeSources');
      const resources = [
        {
          streaming: 'HLS',
          tokenType: 'NONE',
        }
      ];

      SrgSsr.composeAkamaiResources(resources);

      expect(spyOnTokenizeSources).not.toHaveBeenCalled();
    });

    it('should return an array of resources', async () => {
      const resources = [
        {
          streaming: 'HLS',
          tokenType: 'AKAMAI',
        }
      ];

      expect(await SrgSsr.composeAkamaiResources(resources)).toHaveLength(1);
    });
  });

  /**
   *****************************************************************************
   * composeKeySystemsResources ************************************************
   *****************************************************************************
   */
  describe('composeKeySystemsResources', () => {
    it('should return an empty array if the resources are not defined or if the array is empty', () => {
      expect(SrgSsr.composeKeySystemsResources()).toHaveLength(0);
      expect(SrgSsr.composeKeySystemsResources([])).toHaveLength(0);
    });

    it('should not add the keySystems property if no resource has DRM', () => {
      const resources = [
        {
          streaming: 'DASH',
        },
        {
          streaming: 'HLS',
        }
      ];
      const resourcesNoKeySystems =
        SrgSsr.composeKeySystemsResources(resources);

      expect(resourcesNoKeySystems).toMatchObject(resources);
    });

    it('should add the keySystems property if at least one resource has DRM', () => {
      const resources = [
        {
          streaming: 'DASH',
          drmList: [{ type: 'WIDEVINE', licenseUrl: 'https://license.url' }],
        },
        {
          streaming: 'DASH',
        },
        {
          streaming: 'HLS',
          drmList: [
            {
              type: 'FAIRPLAY',
              licenseUrl: 'https://license.url',
              certificateUrl: 'https://certificate.url',
            }
          ],
        },
        {
          streaming: 'HLS',
        }
      ];

      const expectedResources = [
        {
          streaming: 'DASH',
          drmList: [{ type: 'WIDEVINE', licenseUrl: 'https://license.url' }],
          keySystems: { 'com.widevine.alpha': 'https://license.url' },
        },
        {
          streaming: 'DASH',
          keySystems: {},
        },
        {
          streaming: 'HLS',
          drmList: [
            {
              type: 'FAIRPLAY',
              licenseUrl: 'https://license.url',
              certificateUrl: 'https://certificate.url',
            }
          ],
          keySystems: {
            'com.apple.fps.1_0': {
              certificateUri: 'https://certificate.url',
              licenseUri: 'https://license.url',
            },
          },
        },
        {
          streaming: 'HLS',
          keySystems: {},
        }
      ];

      const resourcesWithKeySystems =
        SrgSsr.composeKeySystemsResources(resources);

      expect(resourcesWithKeySystems).toMatchObject(expectedResources);
    });
  });

  /**
   *****************************************************************************
   * composeSrcMediaData *******************************************************
   *****************************************************************************
   */
  describe('composeSrcMediaData', () => {
    it('should return a source object', async () => {
      const mockDataProvider = new DataProvider();
      const { mediaComposition } =
        await mockDataProvider.getMediaCompositionByUrn('urn:fake');
      const [mainSource] = mediaComposition.getMainResources();

      expect(SrgSsr.composeSrcMediaData({}, mainSource)).toMatchObject({
        src: mainSource.url,
        type: mainSource.mimeType,
        keySystems: undefined,
        disableTrackers: undefined,
        mediaData: undefined,
      });
    });
  });

  /**
   *****************************************************************************
   * dataProviderError *********************************************************
   *****************************************************************************
   */
  describe('dataProviderError', () => {
    it('should not generate an error if the error parameter does not contain an url property', async () => {
      const spyOnError = jest.spyOn(SrgSsr, 'error');

      expect(SrgSsr.dataProviderError(player, {})).toBeUndefined();
      expect(spyOnError).not.toHaveBeenCalled();
    });
    it('should generate an error', async () => {
      const spyOnError = jest.spyOn(SrgSsr, 'error');

      jest.spyOn(SrgSsr, 'dataProvider').mockReturnValueOnce({
        baseUrl: 'http://mock.url.ch',
      });

      expect(
        SrgSsr.dataProviderError(player, {
          url: 'http://mock.url.ch',
          status: 404,
          statusText: 'Not Found',
        })
      ).toBe(true);
      expect(spyOnError).toHaveBeenCalledWith(player, expect.any(Object));
    });
  });

  /**
   *****************************************************************************
   * getMediaComposition *******************************************************
   *****************************************************************************
   */
  describe('getMediaComposition', () => {
    it('should use the default DataProvider', async () => {
      const { mediaComposition } = await SrgSsr.getMediaComposition('urn:fake');

      expect(mediaComposition).toBeInstanceOf(MediaComposition);
    });

    it('should return an instance of MediaComposition', async () => {
      const mockDataProvider = new DataProvider();
      const spyOnGetMediaCompositionByUrn = jest.spyOn(
        mockDataProvider,
        'getMediaCompositionByUrn'
      );

      const { mediaComposition } = await SrgSsr.getMediaComposition(
        'urn:fake',
        mockDataProvider
      );

      expect(spyOnGetMediaCompositionByUrn).toHaveBeenCalledWith('urn:fake');
      expect(mediaComposition).toBeInstanceOf(MediaComposition);
    });
  });

  /**
   *****************************************************************************
   * getMediaData **************************************************************
   *****************************************************************************
   */
  describe('getMediaData', () => {
    it('should return the first resource when there is a tokenType', () => {
      const resources = [
        { streaming: 'HLS', tokenType: 'AKAMAI', isFirst: true },
        { streaming: 'HLS', tokenType: 'AKAMAI', isFirst: false }
      ];
      const resource = SrgSsr.getMediaData(resources);

      expect(resource).toMatchObject({
        streaming: 'HLS',
        tokenType: 'AKAMAI',
        isFirst: true,
      });
    });

    it('should return an HLS resource if available for any Safari browser', () => {
      const mockIsAnySafari = jest.replaceProperty(Pillarbox, 'browser', {
        IS_ANY_SAFARI: true,
      });
      const resources = [{ streaming: 'DASH' }, { streaming: 'HLS' }];
      const resource = SrgSsr.getMediaData(resources);

      expect(resource).toMatchObject({ streaming: 'HLS' });
      mockIsAnySafari.restore();
    });

    it('should return a DASH resource if available for any browser other than Safari', () => {
      const resources = [{ streaming: 'HLS' }, { streaming: 'DASH' }];
      const resource = SrgSsr.getMediaData(resources);

      expect(resource).toMatchObject({ streaming: 'DASH' });
    });

    it('should default to the first available resource if no better resource is available', () => {
      const resources = [
        { streaming: 'HLS', isFirst: true },
        { streaming: 'HLS', isFirst: false }
      ];
      const resource = SrgSsr.getMediaData(resources);

      expect(resource).toMatchObject({ streaming: 'HLS', isFirst: true });
    });

    it('should return undefined if the resources are not defined or if the array is empty', () => {
      expect(SrgSsr.getMediaData([])).toBeUndefined();
      expect(SrgSsr.getMediaData()).toBeUndefined();
    });
  });

  /**
   *****************************************************************************
   * error *************************************************************
   *****************************************************************************
   */

  describe('error', () => {
    it('should generate an error', async () => {
      const spyOnPlayerError = jest.spyOn(player, 'error');
      const error = {
        code: 1,
        message: 'error message',
        metadata: { errorType: 'error metadata' },
      };

      SrgSsr.error(player, error);

      expect(spyOnPlayerError).toHaveBeenNthCalledWith(1, null);
      expect(spyOnPlayerError).toHaveBeenNthCalledWith(2, error);
    });
  });

  /**
   *****************************************************************************
   * filterIncompatibleResources ***********************************************
   *****************************************************************************
   */

  describe('filterIncompatibleResources', () => {
    it('should filter incompatible resources', async () => {
      const resources = urnRtsAudio.chapterList[0].resourceList;
      const filteredResources = SrgSsr.filterIncompatibleResources(resources);

      expect(filteredResources).toHaveLength(2);
    });

    it('should return an empty array if no source is compatible', async () => {
      const incompatibleResources = [
        { streaming: 'HDS' },
        { streaming: 'RTMP' }
      ];
      const filteredResources = SrgSsr.filterIncompatibleResources(
        incompatibleResources
      );

      expect(filteredResources).toHaveLength(0);
    });

    it('should return an empty array the resource is undefined', async () => {
      expect(SrgSsr.filterIncompatibleResources()).toHaveLength(0);
    });
  });

  /**
   *****************************************************************************
   * updatePoster **************************************************************
   *****************************************************************************
   */
  describe('updatePoster', () => {
    it('should use the default Image class', async () => {
      const mockDataProvider = new DataProvider();
      const { mediaComposition } =
        await mockDataProvider.getMediaCompositionByUrn('urn:fake');
      const imageUrl = mediaComposition.getMainChapterImageUrl();
      const imageUrlResult = `https://mock-scale.ch/${imageUrl}`;

      const spyOnScale = jest.spyOn(Image, 'scale');
      const spyOnPoster = jest.spyOn(player, 'poster');

      SrgSsr.updatePoster(player, mediaComposition);

      // Image
      expect(spyOnScale).toHaveBeenCalledWith({ url: imageUrl });
      expect(spyOnScale.mock.results[0].value).toBe(imageUrlResult);

      // Poster
      expect(spyOnPoster).toHaveBeenCalledWith(imageUrlResult);
      expect(spyOnPoster.mock.results[0].value).toBe(imageUrlResult);
    });

    it('should update the player\'s poster', async () => {
      const mockDataProvider = new DataProvider();
      const { mediaComposition } =
        await mockDataProvider.getMediaCompositionByUrn('urn:fake');
      const imageUrl = mediaComposition.getMainChapterImageUrl();
      const imageUrlResult = `https://mock-scale.ch/${imageUrl}`;

      const spyOnScale = jest.spyOn(Image, 'scale');
      const spyOnPoster = jest.spyOn(player, 'poster');

      SrgSsr.updatePoster(player, mediaComposition, Image);

      // Image
      expect(spyOnScale).toHaveBeenCalledWith({ url: imageUrl });
      expect(spyOnScale.mock.results[0].value).toBe(imageUrlResult);

      // Poster
      expect(spyOnPoster).toHaveBeenCalledWith(imageUrlResult);
      expect(spyOnPoster.mock.results[0].value).toBe(imageUrlResult);
    });
  });

  /**
   *****************************************************************************
   * updateTitleBar ************************************************************
   *****************************************************************************
   */
  describe('updateTitleBar', () => {
    it('should update the player\'s title bar', async () => {
      const mockDataProvider = new DataProvider();
      const { mediaComposition } =
        await mockDataProvider.getMediaCompositionByUrn('urn:fake');

      const spyOnUpate = jest.spyOn(player.titleBar, 'update');

      SrgSsr.updateTitleBar(player, mediaComposition);

      const result = {
        title: mediaComposition.getMainChapter().vendor,
        description: mediaComposition.getMainChapter().title,
      };

      expect(spyOnUpate).toHaveBeenCalledWith(result);
      expect(spyOnUpate.mock.results[0].value).toMatchObject(result);
    });
  });

  /**
   *****************************************************************************
   * middleware ****************************************************************
   *****************************************************************************
   */
  describe('middleware', () => {
    it('Should use the default Image class', async () => {
      const spyOnComposeAkamaiResources = jest.spyOn(
        SrgSsr,
        'composeAkamaiResources'
      );
      const spyOnComposeKeySystemsResources = jest.spyOn(
        SrgSsr,
        'composeKeySystemsResources'
      );
      const spyOnGetMediaComposition = jest.spyOn(
        SrgSsr,
        'getMediaComposition'
      );
      const spyOnGetMediaData = jest.spyOn(SrgSsr, 'getMediaData');
      const spyOnComposeSrcMediaData = jest.spyOn(
        SrgSsr,
        'composeSrcMediaData'
      );
      const spyOnSrgAnalytics = jest.spyOn(SrgSsr, 'srgAnalytics');
      const spyOnUpdateTitleBar = jest.spyOn(SrgSsr, 'updateTitleBar');
      const spyOnUpdatePoster = jest.spyOn(SrgSsr, 'updatePoster');
      const middleware = SrgSsr.middleware(player);

      await middleware.setSource({ src: 'urn:fake' }, async (err, srcObj) => {
        expect(err).toBeNull();
        expect(srcObj).toEqual(expect.any(Object));
      });

      expect(middleware).toMatchObject({
        setSource: expect.any(Function),
      });
      expect(spyOnGetMediaComposition).toHaveBeenCalled();
      expect(spyOnComposeKeySystemsResources).toHaveBeenCalled();
      expect(spyOnComposeAkamaiResources).toHaveBeenCalled();
      expect(spyOnGetMediaData).toHaveBeenCalled();
      expect(spyOnComposeSrcMediaData).toHaveBeenCalled();
      expect(spyOnSrgAnalytics).toHaveBeenCalled();
      expect(spyOnUpdateTitleBar).toHaveBeenCalled();
      expect(spyOnUpdatePoster).toHaveBeenCalled();
    });

    it('Should call the next middleware without error', async () => {
      const spyOnComposeAkamaiResources = jest.spyOn(
        SrgSsr,
        'composeAkamaiResources'
      );
      const spyOnComposeKeySystemsResources = jest.spyOn(
        SrgSsr,
        'composeKeySystemsResources'
      );
      const spyOnGetMediaComposition = jest.spyOn(
        SrgSsr,
        'getMediaComposition'
      );
      const spyOnGetMediaData = jest.spyOn(SrgSsr, 'getMediaData');
      const spyOnComposeSrcMediaData = jest.spyOn(
        SrgSsr,
        'composeSrcMediaData'
      );
      const spyOnSrgAnalytics = jest.spyOn(SrgSsr, 'srgAnalytics');
      const spyOnUpdateTitleBar = jest.spyOn(SrgSsr, 'updateTitleBar');
      const spyOnUpdatePoster = jest.spyOn(SrgSsr, 'updatePoster');
      const middleware = SrgSsr.middleware(player, Image);

      await middleware.setSource({ src: 'urn:fake' }, async (err, srcObj) => {
        expect(err).toBeNull();
        expect(srcObj).toEqual(expect.any(Object));
      });

      expect(middleware).toMatchObject({
        setSource: expect.any(Function),
      });
      expect(spyOnGetMediaComposition).toHaveBeenCalled();
      expect(spyOnComposeKeySystemsResources).toHaveBeenCalled();
      expect(spyOnComposeAkamaiResources).toHaveBeenCalled();
      expect(spyOnGetMediaData).toHaveBeenCalled();
      expect(spyOnComposeSrcMediaData).toHaveBeenCalled();
      expect(spyOnSrgAnalytics).toHaveBeenCalled();
      expect(spyOnUpdateTitleBar).toHaveBeenCalled();
      expect(spyOnUpdatePoster).toHaveBeenCalled();
    });

    it('Should catch and error if the source is not defined', async () => {
      const spyOnComposeAkamaiResources = jest.spyOn(
        SrgSsr,
        'composeAkamaiResources'
      );
      const spyOnComposeKeySystemsResources = jest.spyOn(
        SrgSsr,
        'composeKeySystemsResources'
      );
      const spyOnGetMediaComposition = jest.spyOn(
        SrgSsr,
        'getMediaComposition'
      );
      const spyOnGetMediaData = jest.spyOn(SrgSsr, 'getMediaData');
      const spyOnComposeSrcMediaData = jest.spyOn(
        SrgSsr,
        'composeSrcMediaData'
      );
      const spyOnUpdateTitleBar = jest.spyOn(SrgSsr, 'updateTitleBar');
      const spyOnUpdatePoster = jest.spyOn(SrgSsr, 'updatePoster');
      const middleware = SrgSsr.middleware(player, Image);

      await middleware.setSource(undefined, async (err) => {
        expect(err).toEqual(expect.any(Error));
      });

      expect(middleware).toMatchObject({
        setSource: expect.any(Function),
      });
      expect(spyOnGetMediaComposition).not.toHaveBeenCalled();
      expect(spyOnComposeKeySystemsResources).not.toHaveBeenCalled();
      expect(spyOnComposeAkamaiResources).not.toHaveBeenCalled();
      expect(spyOnGetMediaData).not.toHaveBeenCalled();
      expect(spyOnComposeSrcMediaData).not.toHaveBeenCalled();
      expect(spyOnUpdateTitleBar).not.toHaveBeenCalled();
      expect(spyOnUpdatePoster).not.toHaveBeenCalled();
    });

    it('Should return undefined and generate an error if the media has a block reason', async () => {
      jest.spyOn(SrgSsr, 'getMediaData').mockReturnValueOnce({
        analyticsData: {},
        analyticsMetadata: {},
        blockReason: 'STARTDATE',
        vendor: 'SRF',
        dvr: true,
        eventData: '',
        id: '',
        imageCopyright: '',
        live: true,
        mediaType: 'VIDEO',
        mimeType: 'application/x-mpegURL',
        presentation: '',
        quality: '',
        streaming: '',
        url: 'https://fake.stream.url.ch/',
      });

      const spyOnBlockingReason = jest.spyOn(SrgSsr, 'blockingReason');
      const result = await SrgSsr.middleware(player).setSource(
        { src: 'urn:fake' },
        jest.fn().mockResolvedValue(true)
      );

      expect(result).toBeUndefined();
      expect(spyOnBlockingReason).toHaveBeenCalledWith(
        player,
        'STARTDATE',
        expect.any(Object)
      );
    });

    it('Should return undefined and generate an error the URN doest not exist', async () => {
      const spyOnDataProvider = jest
        .spyOn(SrgSsr, 'dataProvider')
        .mockReturnValue({
          baseUrl: 'http://mock.url.ch',
        });
      const spyOnError = jest.spyOn(SrgSsr, 'error');
      const spyOnDataProviderError = jest.spyOn(SrgSsr, 'dataProviderError');

      jest.spyOn(SrgSsr, 'getMediaComposition').mockRejectedValueOnce({
        status: '404',
        statusText: 'Not Found',
        url: 'http://mock.url.ch',
      });

      const result = await SrgSsr.middleware(player).setSource(
        { src: 'urn:fake' },
        jest.fn().mockResolvedValue(true)
      );

      expect(result).toBeUndefined();
      expect(spyOnDataProviderError.mock.results[0].value).toBe(true);
      expect(spyOnError).toHaveBeenCalledWith(player, expect.any(Object));

      spyOnDataProvider.mockReset();
    });
  });
});
