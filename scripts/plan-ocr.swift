import Foundation
import Vision
import AppKit
import PDFKit
let url = URL(fileURLWithPath: CommandLine.arguments[1])
var images: [CGImage] = []
if url.pathExtension.lowercased() == "pdf" {
    guard let doc = PDFDocument(url: url), doc.pageCount <= 12 else { fatalError("PDF must contain 1-12 pages") }
    for i in 0..<doc.pageCount {
        let page = doc.page(at: i)!
        let size = page.bounds(for: .mediaBox).size
        let scale = min(2400 / max(size.width, size.height), 3)
        let image = page.thumbnail(of: NSSize(width:size.width*scale,height:size.height*scale), for: .mediaBox)
        var rect = CGRect(origin: .zero, size: image.size)
        if let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) { images.append(cg) }
    }
} else {
    guard let image = NSImage(contentsOf:url) else { fatalError("Invalid image") }
    var rect = CGRect(origin: .zero, size: image.size)
    if let cg = image.cgImage(forProposedRect:&rect,context:nil,hints:nil) { images.append(cg) }
}
var result: [[String:Any]] = []
for (index,image) in images.enumerated() {
    // Scanned Malaysian plans frequently rotate room labels 90 degrees.
    // Run Vision in all four orientations, then deduplicate overlapping hits.
    var seen = Set<String>()
    for orientation in [CGImagePropertyOrientation.up, .right, .down, .left] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US", "zh-Hans"]
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage:image, orientation: orientation, options:[:]).perform([request])
        for line in request.results ?? [] {
            guard let text = line.topCandidates(1).first else { continue }
            let bx=line.boundingBox.midX, by=line.boundingBox.midY
            // Convert the orientation-specific box center back to the page's
            // upright coordinate system before de-duplicating.
            let canonical:(CGFloat,CGFloat)
            switch orientation {
            case .right: canonical=(1-by,bx)
            case .down: canonical=(1-bx,1-by)
            case .left: canonical=(by,1-bx)
            default: canonical=(bx,by)
            }
            // OCR boxes drift slightly between orientations; a 5% grid keeps
            // the same rotated label from appearing as a second room while
            // preserving rooms that are actually separated on the plan.
            let key = "\(text.string.lowercased())|\(Int(canonical.0 * 20))|\(Int(canonical.1 * 20))"
            if seen.contains(key) { continue }
            seen.insert(key)
            result.append(["page":index+1,"text":text.string,"confidence":text.confidence,"x":line.boundingBox.midX,"y":line.boundingBox.midY,"orientation":orientation.rawValue])
        }
    }
}
let data = try JSONSerialization.data(withJSONObject:result)
print(String(data:data,encoding:.utf8)!)
