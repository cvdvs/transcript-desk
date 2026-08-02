// ocr — reads the text out of an image using Apple's Vision framework.
// Local, free, and good at it. Whisper for sound, Vision for pixels.
//
// Build: clang -fobjc-arc -O2 -framework Foundation -framework ImageIO \
//        -framework Vision -framework CoreGraphics -o ocr ocr.m
// Usage: ocr <image-path>   (prints recognized text lines to stdout)

#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) {
            fprintf(stderr, "usage: ocr <image-path>\n");
            return 2;
        }
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
        CGImageSourceRef src = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
        if (!src) {
            fprintf(stderr, "could not open image\n");
            return 1;
        }
        CGImageRef image = CGImageSourceCreateImageAtIndex(src, 0, NULL);
        CFRelease(src);
        if (!image) {
            fprintf(stderr, "could not decode image\n");
            return 1;
        }

        VNRecognizeTextRequest *req = [[VNRecognizeTextRequest alloc] init];
        req.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        req.usesLanguageCorrection = YES;
        if (@available(macOS 13.0, *)) {
            req.automaticallyDetectsLanguage = YES;
        }

        VNImageRequestHandler *handler =
            [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
        NSError *error = nil;
        BOOL ok = [handler performRequests:@[ req ] error:&error];
        CGImageRelease(image);
        if (!ok) {
            fprintf(stderr, "ocr failed: %s\n", error.localizedDescription.UTF8String);
            return 1;
        }

        NSMutableArray<NSString *> *lines = [NSMutableArray array];
        for (VNRecognizedTextObservation *obs in req.results) {
            VNRecognizedText *top = [obs topCandidates:1].firstObject;
            if (top.string.length) [lines addObject:top.string];
        }
        printf("%s\n", [lines componentsJoinedByString:@"\n"].UTF8String);
        return 0;
    }
}
