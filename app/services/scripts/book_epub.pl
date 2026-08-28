#!/usr/bin/perl
use strict;
use warnings;
use XML::LibXML;
use Archive::Zip qw( :ERROR_CODES :CONSTANTS );
use File::Path qw(make_path remove_tree);
use File::Basename;
use File::Copy;

# 1. Command-Line Arguments
my $dir_path   = $ARGV[0];
my $css_file   = $ARGV[1];
my $book_title = $ARGV[2] || "Complete Book";

unless ($dir_path && $css_file) {
    die "Usage: perl $0 <folder_path> <path_to_css> [book_title]\n"
      . "Example: perl $0 \"d:/s4c/wordtoxml/test/html/\" \"book_style.css\" \"My Book\"\n";
}


die "Folder '$dir_path' does not exist!\n" unless -d $dir_path;
#die "CSS File '$css_file' not found!\n" unless -e $css_file;

$css_file = merge_css_files($dir_path, $css_file);

# Read all XML files and sort them alphabetically
opendir(my $dh, $dir_path) or die "Cannot open directory '$dir_path': $!\n";
my @xml_files = sort grep { /\.xml$/i } readdir($dh);
closedir($dh);

die "No XML files found in directory '$dir_path'\n" unless @xml_files;

print "Found " . scalar(@xml_files) . " chapter(s) to merge into a single EPUB.\n";

chdir($dir_path) or die "Cannot chdir to '$dir_path': $!\n";

# Setup Build Directory
my $build_dir = "epub_combined_build";
remove_tree($build_dir) if -d $build_dir;
make_path("$build_dir/META-INF", "$build_dir/OEBPS/images", "$build_dir/OEBPS/font");

# 2. Write Base Files (mimetype & container.xml)
open my $fh_mime, '>', "$build_dir/mimetype" or die $!;
print $fh_mime "application/epub+zip";
close $fh_mime;

open my $fh_container, '>', "$build_dir/META-INF/container.xml" or die $!;
print $fh_container <<'XML';
<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
XML
close $fh_container;

# Copy CSS
copy($css_file, "$build_dir/OEBPS/stylesheet.css") or die "Failed to copy CSS: $!\n";

# 3. Scan CSS for Font Assets
my %fonts_to_pack;
open my $fh_css_read, '<', $css_file or die $!;
while (my $line = <$fh_css_read>) {
    while ($line =~ /url\s*\(\s*['"]?([^'"]+?\.otf|ttf|woff|woff2)['"]?\s*\)/gi) {
        my $font_name = basename($1);
        if (-e $font_name) {
            copy($font_name, "$build_dir/OEBPS/font/$font_name");
            $fonts_to_pack{$font_name} = 1;
        } elsif (-e "font/$font_name") {
            copy("font/$font_name", "$build_dir/OEBPS/font/$font_name");
            $fonts_to_pack{$font_name} = 1;
        }
    }
}
close $fh_css_read;

# Metadata structures for OPF and TOC
my %images_to_pack;
my @toc_entries;
my @spine_items;
my @manifest_chapters;
my $book_author = '';

# 4. Process Each Chapter XML
my $chapter_index = 1;
foreach my $xml_file (@xml_files) {
    print "Processing chapter [$chapter_index/$#xml_files+1]: $xml_file\n";

    my $dom = XML::LibXML->load_xml(
        location => $xml_file,
        load_ext_dtd => 0,
        expand_entities => 0
    );

    # Metadata extraction
    my $chap_num   = $dom->findvalue('//book-part-meta/title-group/label') || $chapter_index;
    my $chap_title = $dom->findvalue('//book-part-meta/title-group/title') || "Chapter $chapter_index";

    unless ($book_author) {
        my @authors;
        foreach my $contrib ($dom->findnodes('//contrib[@contrib-type="author"]')) {
            push @authors, $contrib->findvalue('./name/given-names') . " " . $contrib->findvalue('./name/surname');
        }
        $book_author = join(', ', @authors);
    }

    # Generate Chapter File Name & Content
    my $xhtml_filename = sprintf("chapter_%02d.xhtml", $chapter_index);
    my $chap_id        = sprintf("ch_%02d", $chapter_index);

    my $xhtml_body = process_node($dom->findnodes('//book-part')->[0], \%images_to_pack, $build_dir, $book_author);

    my $xhtml_content = <<"XHTML";
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <meta charset="utf-8"/>
  <title>$chap_title</title>
  <link rel="stylesheet" type="text/css" href="stylesheet.css"/>
</head>
<body>
$xhtml_body
</body>
</html>
XHTML

    open my $fh_ch, '>', "$build_dir/OEBPS/$xhtml_filename" or die $!;
    print $fh_ch $xhtml_content;
    close $fh_ch;

    # Collect OPF & TOC information
    push @manifest_chapters, qq(    <item id="$chap_id" href="$xhtml_filename" media-type="application/xhtml+xml"/>);
    push @spine_items,       qq(    <itemref idref="$chap_id"/>);
    push @toc_entries,       qq(    <li><a href="$xhtml_filename">$chap_num. $chap_title</a></li>);

    $chapter_index++;
}

# 5. Write Master Table of Contents (toc.xhtml)
open my $fh_toc, '>', "$build_dir/OEBPS/toc.xhtml" or die $!;
print $fh_toc <<"TOC";
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title></head>
<body>
<nav epub:type="toc" id="toc">
  <h1>Table of Contents</h1>
  <ol>
@{[ join("\n", @toc_entries) ]}
  </ol>
</nav>
</body>
</html>
TOC
close $fh_toc;

# 6. Build Master Package File (content.opf)
my $manifest_assets = '';
while (my ($img_id, $img_info) = each %images_to_pack) {
    $manifest_assets .= "    <item id=\"$img_id\" href=\"images/$img_info->{filename}\" media-type=\"$img_info->{mimetype}\"/>\n";
}

my $font_count = 1;
foreach my $font_file (keys %fonts_to_pack) {
    my $mime = ($font_file =~ /\.otf$/i) ? "application/font-sfnt" : "font/ttf";
    $manifest_assets .= "    <item id=\"font_$font_count\" href=\"font/$font_file\" media-type=\"$mime\"/>\n";
    $font_count++;
}

open my $fh_opf, '>', "$build_dir/OEBPS/content.opf" or die $!;
print $fh_opf <<"OPF";
<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier>
    <dc:title>$book_title</dc:title>
    <dc:creator>$book_author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="stylesheet.css" media-type="text/css"/>
@{[ join("\n", @manifest_chapters) ]}
$manifest_assets  </manifest>
  <spine>
@{[ join("\n", @spine_items) ]}
  </spine>
</package>
OPF
close $fh_opf;

# 7. Package Combined EPUB
my $zip = Archive::Zip->new();
my $file_mime = $zip->addFile("$build_dir/mimetype", "mimetype");
$file_mime->desiredCompressionMethod(COMPRESSION_STORED);

$zip->addDirectory("META-INF");
$zip->addFile("$build_dir/META-INF/container.xml", "META-INF/container.xml");

$zip->addDirectory("OEBPS");
$zip->addFile("$build_dir/OEBPS/content.opf", "OEBPS/content.opf");
$zip->addFile("$build_dir/OEBPS/toc.xhtml", "OEBPS/toc.xhtml");
$zip->addFile("$build_dir/OEBPS/stylesheet.css", "OEBPS/stylesheet.css");

# Add all transformed chapters to ZIP
for (my $i = 1; $i < $chapter_index; $i++) {
    my $fn = sprintf("chapter_%02d.xhtml", $i);
    $zip->addFile("$build_dir/OEBPS/$fn", "OEBPS/$fn");
}

if (keys %images_to_pack) {
    $zip->addDirectory("OEBPS/images");
    while (my ($id, $info) = each %images_to_pack) {
        $zip->addFile("$build_dir/OEBPS/images/$info->{filename}", "OEBPS/images/$info->{filename}");
    }
}

if (keys %fonts_to_pack) {
    $zip->addDirectory("OEBPS/font");
    foreach my $font_file (keys %fonts_to_pack) {
        $zip->addFile("$build_dir/OEBPS/font/$font_file", "OEBPS/font/$font_file");
    }
}

my $final_filename = "combined_book.epub";
unless ($zip->writeToFileNamed($final_filename) == AZ_OK) {
    die "Error writing $final_filename archive";
}

remove_tree($build_dir);
print "\nSuccess! Single combined EPUB generated: $final_filename\n";

# Merging all css into single css
sub merge_css_files {
    my ($dir_path, $output_css) = @_;

    opendir(my $dh, $dir_path) or die "Cannot open directory '$dir_path': $!\n";
    my @css_files = sort grep { /\.css$/i && $_ ne 'stylesheet.css' } readdir($dh);
    closedir($dh);

    my %css_rules;       # Keeps merged styles: $css_rules{".Para-FL"} = "font-size: 1em; color: #000;"
    my @rule_order;      # Preserves original order of selectors
    my %seen_font_faces; # Prevents duplicate @font-face blocks

    print "Processing " . scalar(@css_files) . " CSS file(s) for unique merging...\n";

    foreach my $file (@css_files) {
        open my $fh, '<', "$dir_path/$file" or next;
        local $/ = undef; # Read entire file
        my $content = <$fh>;
        close $fh;

        # 1. Remove CSS Comments
        $content =~ s=/\*.*?\*/==gs;

        # 2. Extract and Deduplicate @font-face rules
        while ($content =~ s/(\@font-face\s*\{[^}]+\})//s) {
            my $font_block = $1;
            # Clean up whitespace inside block for exact comparison
            my $clean_font = $font_block;
            $clean_font =~ s/\s+/ /g;
            $seen_font_faces{$clean_font} = $font_block;
        }

        # 3. Parse Standard Selectors & Rule Blocks
        while ($content =~ /([^{]+)\{([^}]+)\}/g) {
            my $selector = $1;
            my $body     = $2;

            # Trim whitespace
            $selector =~ s/^\s+|\s+$//g;
            $selector =~ s/\s+/ /g;

            # Parse properties into key-value pairs
            my %properties;
            foreach my $prop_line (split /;/, $body) {
                if ($prop_line =~ /^\s*([^:]+)\s*:\s*(.+)$/) {
                    my $key = lc($1);
                    my $val = $2;
                    $key =~ s/^\s+|\s+$//g;
                    $val =~ s/^\s+|\s+$//g;
                    $properties{$key} = $val;
                }
            }

            # If selector hasn't been seen, record order
            unless (exists $css_rules{$selector}) {
                push @rule_order, $selector;
                $css_rules{$selector} = {};
            }

            # Merge properties (newer/later chapter properties overwrite existing ones)
            while (my ($k, $v) = each %properties) {
                $css_rules{$selector}->{$k} = $v;
            }
        }
    }

    # 4. Write Clean, Unique CSS
    open my $out_fh, '>', $output_css or die "Cannot create master CSS: $!\n";

    # Write unique @font-face definitions
    if (keys %seen_font_faces) {
        print $out_fh "/* Merged Font Faces */\n";
        foreach my $ff (values %seen_font_faces) {
            print $out_fh "$ff\n\n";
        }
    }

    # Write deduplicated style rules
    print $out_fh "/* Merged & Unique Chapter Styles */\n";
    foreach my $selector (@rule_order) {
        my $props_ref = $css_rules{$selector};
        next unless keys %$props_ref;

        print $out_fh "$selector {\n";
        foreach my $prop (sort keys %$props_ref) {
            print $out_fh "  $prop: $props_ref->{$prop};\n";
        }
        print $out_fh "}\n\n";
    }

    close $out_fh;
    print " Master stylesheet generated with UNIQUE rules: $output_css\n";
    return $output_css;
}

# Dynamic Node Transformer Subroutine
sub process_node {
    my ($node, $images_ref, $build_dir, $author_str) = @_;
    return '' unless $node;

    my $output = '';

    foreach my $child ($node->childNodes()) {
        if ($child->nodeType == XML_TEXT_NODE) {
            my $txt = $child->nodeValue;
            $txt =~ s/&/&amp;/g; $txt =~ s/</&lt;/g; $txt =~ s/>/&gt;/g;
            $output .= $txt;
        }
        elsif ($child->nodeType == XML_ELEMENT_NODE) {
            my $tag = $child->nodeName;

            if ($tag eq 'book-part-meta') {
                my $label = $child->findvalue('./title-group/label');
                my $title = $child->findvalue('./title-group/title');
                $output .= "<p class=\"ChapterNumber\">Chapter $label</p>\n";
                $output .= "<p class=\"ChapterTitle\">$title</p>\n";
                if ($author_str) {
                    $output .= "<p class=\"ChapterAuthor\">By $author_str</p>\n";
                }
            }
            elsif ($tag eq 'sec') {
                my $id = $child->getAttribute('id') || '';
                $output .= "<section id=\"$id\">\n" . process_node($child, $images_ref, $build_dir, $author_str) . "</section>\n";
            }
            elsif ($tag eq 'title') {
                my $parent = $child->parentNode->nodeName;
                if ($parent eq 'sec') {
                    $output .= "<p class=\"Head1\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</p>\n";
                } elsif ($parent eq 'boxed-text') {
                    $output .= "<p class=\"FE-CaseStudyTitle\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</p>\n";
                } else {
                    $output .= "<p class=\"Head2-copy\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</p>\n";
                }
            }
            elsif ($tag eq 'p') {
                $output .= "<p class=\"Para-FL\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</p>\n";
            }
            elsif ($tag eq 'list') {
                my $type = ($child->getAttribute('list-type') && $child->getAttribute('list-type') eq 'order') ? 'ol' : 'ul';
                $output .= "<$type>\n" . process_node($child, $images_ref, $build_dir, $author_str) . "</$type>\n";
            }
            elsif ($tag eq 'list-item') {
                $output .= "<li class=\"BulletList1\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</li>\n";
            }
            elsif ($tag eq 'italic') {
                $output .= "<span class=\"italic\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</span>";
            }
            elsif ($tag eq 'bold') {
                $output .= "<span class=\"bold\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</span>";
            }
            elsif ($tag eq 'xref') {
                my $rid = $child->getAttribute('rid') || '';
                $output .= "<a href=\"#$rid\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</a>";
            }
            elsif ($tag eq 'boxed-text') {
                my $id = $child->getAttribute('id') || '';
                $output .= "<div class=\"CS-box\" id=\"$id\">\n" . process_node($child, $images_ref, $build_dir, $author_str) . "</div>\n";
            }
            elsif ($tag eq 'fig') {
                my $id = $child->getAttribute('id') || '';
                $output .= "<figure id=\"$id\">\n" . process_node($child, $images_ref, $build_dir, $author_str) . "</figure>\n";
            }
            elsif ($tag eq 'graphic') {
                my $href = $child->getAttribute('xlink:href') || '';
                $href =~ s/\.eps$/\.svg/i;
                $href .= ".svg" unless $href =~ /\.[a-z0-9]+$/i;

                my $filename = basename($href);
                my $img_id   = "img_" . (keys(%$images_ref) + 1);

                if (-e $filename) {
                    copy($filename, "$build_dir/OEBPS/images/$filename");
                    my $mime = "image/svg+xml";
                    $mime = "image/png" if $filename =~ /\.png$/i;
                    $mime = "image/jpeg" if $filename =~ /\.jpe?g$/i;

                    $images_ref->{$img_id} = {
                        filename => $filename,
                        mimetype => $mime
                    };
                }

                $output .= "<img src=\"images/$filename\" alt=\"Figure Image\"/>\n";
            }
            elsif ($tag eq 'caption') {
                $output .= "<p class=\"TableCaption\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</p>\n";
            }
            elsif ($tag eq 'table-wrap') {
                my $id = $child->getAttribute('id') || '';
                $output .= "<div class=\"_idGenObjectStyleOverride-1\" id=\"$id\">\n" . process_node($child, $images_ref, $build_dir, $author_str) . "</div>\n";
            }
            elsif ($tag eq 'table') {
                $output .= "<table class=\"No-Table-Style\">\n" . process_node($child, $images_ref, $build_dir, $author_str) . "</table>\n";
            }
            elsif ($tag eq 'tr') {
                $output .= "<tr class=\"No-Table-Style\">\n" . process_node($child, $images_ref, $build_dir, $author_str) . "</tr>\n";
            }
            elsif ($tag eq 'th') {
                $output .= "<th class=\"TableColumnHead1\">\n<p class=\"TableColumnHead1\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</p>\n</th>\n";
            }
            elsif ($tag eq 'td') {
                $output .= "<td class=\"TableBody\">\n<p class=\"TableBody\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</p>\n</td>\n";
            }
            elsif ($tag eq 'ref-list') {
                $output .= "<section class=\"ref-list\">\n<p class=\"Head1\">References</p>\n" . process_node($child, $images_ref, $build_dir, $author_str) . "</section>\n";
            }
            elsif ($tag eq 'ref') {
                my $id = $child->getAttribute('id') || '';
                $output .= "<p class=\"Reference-Alphabetical\" id=\"$id\">" . process_node($child, $images_ref, $build_dir, $author_str) . "</p>\n";
            }
            else {
                $output .= process_node($child, $images_ref, $build_dir, $author_str);
            }
        }
    }
    return $output;
}