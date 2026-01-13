#include <iostream>
#include <string>
#include <sstream>
#include <chrono>
#include <ctime>
#include <openssl/hmac.h>
#include <openssl/evp.h>
#include <openssl/buffer.h>

class HmacRequestSigner {
public:
    HmacRequestSigner(const std::string& apiKey,
                      const std::string& baseSecret,
                      int periodSeconds = 60)
        : apiKey_(apiKey), baseSecret_(baseSecret), period_(periodSeconds) {}

    // Genera los headers HMAC
    std::string signHeaders(const std::string& method, const std::string& fullUrl) const {
        std::string path = extractPath(fullUrl);
        std::string timestamp = isoTimestamp();
        std::string derived = deriveSecret();

        std::ostringstream canonical;
        canonical << toUpper(method) << "\n" << path << "\n"
                  << apiKey_ << "\n" << timestamp;

        // Calcula HMAC-SHA256
        unsigned char hmac_result[EVP_MAX_MD_SIZE];
        unsigned int len = 0;
        HMAC(EVP_sha256(),
             derived.data(), derived.size(),
             reinterpret_cast<const unsigned char*>(canonical.str().data()), canonical.str().size(),
             hmac_result, &len);

        std::string sig_bin(reinterpret_cast<char*>(hmac_result), len);
        std::string signature = toBase64(sig_bin);

        std::ostringstream out;
        out << "X-Service: " << apiKey_ << "\n"
            << "X-Timestamp: " << timestamp << "\n"
            << "X-Signature: " << signature;
        return out.str();
    }

private:
    std::string apiKey_;
    std::string baseSecret_;
    int period_;

    std::string deriveSecret() const {
        long long slice = std::chrono::duration_cast<std::chrono::seconds>(
                              std::chrono::system_clock::now().time_since_epoch())
                              .count() / period_;
        std::string sliceStr = std::to_string(slice);
        unsigned char out[EVP_MAX_MD_SIZE];
        unsigned int len = 0;
        HMAC(EVP_sha256(),
             baseSecret_.data(), baseSecret_.size(),
             reinterpret_cast<const unsigned char*>(sliceStr.data()), sliceStr.size(),
             out, &len);
        return std::string(reinterpret_cast<char*>(out), len);
    }

    static std::string toUpper(std::string s) {
        for (auto& c : s) c = static_cast<char>(::toupper(c));
        return s;
    }

    static std::string toBase64(const std::string& input) {
        BIO* b64 = BIO_new(BIO_f_base64());
        BIO* bio = BIO_new(BIO_s_mem());
        bio = BIO_push(b64, bio);
        BIO_set_flags(bio, BIO_FLAGS_BASE64_NO_NL);
        BIO_write(bio, input.data(), input.size());
        BIO_flush(bio);
        BUF_MEM* bufferPtr;
        BIO_get_mem_ptr(bio, &bufferPtr);
        std::string output(bufferPtr->data, bufferPtr->length);
        BIO_free_all(bio);
        return output;
    }

    static std::string isoTimestamp() {
        auto now = std::chrono::system_clock::now();
        std::time_t t = std::chrono::system_clock::to_time_t(now);
        std::tm tm_utc;
#if defined(_WIN32)
        gmtime_s(&tm_utc, &t);
#else
        gmtime_r(&t, &tm_utc);
#endif
        char buf[32];
        std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
        return buf;
    }

    static std::string extractPath(const std::string& fullUrl) {
        size_t pos = fullUrl.find("://");
        size_t start = (pos == std::string::npos) ? 0 : pos + 3;
        size_t slash = fullUrl.find('/', start);
        if (slash == std::string::npos) return "/";
        size_t qmark = fullUrl.find('?', slash);
        if (qmark == std::string::npos) return fullUrl.substr(slash);
        return fullUrl.substr(slash, qmark - slash);
    }
};

void testSignerOnly() {
    const std::string url = "http://192.168.1.245:8089/api/v2/nodes";

    HmacRequestSigner signer("core", "super-secret-b", 5);
    std::string headersRaw = signer.signHeaders("GET", url);

    std::cout << "🔐 Headers HMAC generados:\n" << headersRaw << "\n\n";
    std::cout << "✅ Generación de headers exitosa!\n";
    std::cout << "📝 URL procesada: " << url << "\n";
}

int main() {
    std::cout << "🚀 Probando HMAC Request Signer...\n\n";
    testSignerOnly();
    return 0;
}